//! Framework-neutral immutable file browser and document stores.
//!
//! Constructors allocate state only. Public actions synchronously replace the
//! snapshot and then emit one typed output. Authoritative writers never emit.

use std::{collections::BTreeMap, fmt, sync::Arc};

use super::protocol::{
    FileMatch, FileTreeEntry, MAX_DIRECTORY_COUNT, MAX_EDITOR_BYTES, MAX_ENTRY_COUNT,
    MAX_REVISION_BYTES, RelativeDirectoryPath, RelativeFilePath,
};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FileWorkspaceId(Arc<str>);
impl FileWorkspaceId {
    pub fn new(value: impl Into<Arc<str>>) -> Self {
        Self(value.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileAvailability {
    Online,
    Offline,
    Reconnecting,
    Draining,
}

/// Synchronous admission result for a store output. Rejection is projected
/// back into the same store before its public action returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileOutputAdmission {
    Accepted,
    Rejected,
}

const OUTPUT_REJECTED_MESSAGE: &str = "The file request queue is unavailable. Retry the operation.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadState {
    Idle,
    Loading,
    Ready,
    Staged,
    Evicted,
    Failed(Arc<str>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DirectorySnapshot {
    pub path: RelativeDirectoryPath,
    pub entries: Vec<Arc<FileTreeEntry>>,
    pub next_cursor: Option<Arc<str>>,
    pub state: LoadState,
    pub stale: bool,
    pub visible: bool,
    pub generation: u64,
    pub entries_truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileBrowserSnapshot {
    pub workspace: FileWorkspaceId,
    pub availability: FileAvailability,
    pub query: Arc<str>,
    pub search_state: LoadState,
    pub matches: Vec<Arc<FileMatch>>,
    pub directories: BTreeMap<RelativeDirectoryPath, Arc<DirectorySnapshot>>,
    pub directory_limit_reached: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileBrowserOutput {
    SearchRequested {
        workspace: FileWorkspaceId,
        query: Arc<str>,
    },
    DirectoryRequested {
        workspace: FileWorkspaceId,
        path: RelativeDirectoryPath,
        cursor: Option<Arc<str>>,
        generation: u64,
    },
}

type BrowserListener = Arc<dyn Fn(FileBrowserOutput) -> FileOutputAdmission + Send + Sync>;

pub struct FileBrowserStore {
    snapshot: Arc<FileBrowserSnapshot>,
    listener: BrowserListener,
}
impl fmt::Debug for FileBrowserStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FileBrowserStore")
            .field("snapshot", &self.snapshot)
            .finish()
    }
}
impl FileBrowserStore {
    pub fn new(workspace: FileWorkspaceId) -> Self {
        Self::with_listener(workspace, |_| {})
    }
    pub fn with_listener(
        workspace: FileWorkspaceId,
        listener: impl Fn(FileBrowserOutput) + Send + Sync + 'static,
    ) -> Self {
        Self::with_admission_listener(workspace, move |output| {
            listener(output);
            FileOutputAdmission::Accepted
        })
    }
    pub(crate) fn with_admission_listener(
        workspace: FileWorkspaceId,
        listener: impl Fn(FileBrowserOutput) -> FileOutputAdmission + Send + Sync + 'static,
    ) -> Self {
        Self {
            snapshot: Arc::new(FileBrowserSnapshot {
                workspace,
                availability: FileAvailability::Offline,
                query: Arc::from(""),
                search_state: LoadState::Idle,
                matches: Vec::new(),
                directories: BTreeMap::new(),
                directory_limit_reached: false,
            }),
            listener: Arc::new(listener),
        }
    }
    fn emit(&mut self, output: FileBrowserOutput) {
        if (self.listener)(output.clone()) == FileOutputAdmission::Accepted {
            return;
        }
        match output {
            FileBrowserOutput::SearchRequested { query, .. } => self
                .authoritative()
                .search_fail(&query, OUTPUT_REJECTED_MESSAGE),
            FileBrowserOutput::DirectoryRequested {
                path, generation, ..
            } => self
                .authoritative()
                .directory_fail(&path, generation, OUTPUT_REJECTED_MESSAGE),
        }
    }
    pub fn snapshot(&self) -> &Arc<FileBrowserSnapshot> {
        &self.snapshot
    }
    pub fn search_update(&mut self, query: impl Into<Arc<str>>) {
        let query = query.into();
        if self.snapshot.query == query
            && !matches!(self.snapshot.search_state, LoadState::Failed(_))
        {
            return;
        }
        let mut next = (*self.snapshot).clone();
        next.query = query.clone();
        next.search_state = LoadState::Loading;
        next.matches.clear();
        self.snapshot = Arc::new(next);
        self.emit(FileBrowserOutput::SearchRequested {
            workspace: self.snapshot.workspace.clone(),
            query,
        });
    }
    pub fn directory_materialize(&mut self, path: RelativeDirectoryPath) {
        if self.snapshot.directories.contains_key(&path) {
            return;
        }
        if self.snapshot.directories.len() >= MAX_DIRECTORY_COUNT {
            if !self.snapshot.directory_limit_reached {
                let mut next = (*self.snapshot).clone();
                next.directory_limit_reached = true;
                self.snapshot = Arc::new(next);
            }
            return;
        }
        let mut next = (*self.snapshot).clone();
        next.directories.insert(
            path.clone(),
            Arc::new(DirectorySnapshot {
                path: path.clone(),
                entries: Vec::new(),
                next_cursor: None,
                state: LoadState::Loading,
                stale: false,
                visible: true,
                generation: 0,
                entries_truncated: false,
            }),
        );
        self.snapshot = Arc::new(next);
        self.emit(FileBrowserOutput::DirectoryRequested {
            workspace: self.snapshot.workspace.clone(),
            path,
            cursor: None,
            generation: 0,
        });
    }
    pub fn directory_visibility_update(&mut self, path: &RelativeDirectoryPath, visible: bool) {
        let Some(directory) = self.snapshot.directories.get(path) else {
            return;
        };
        if directory.visible == visible {
            return;
        }
        let mut row = (**directory).clone();
        row.visible = visible;
        let should_load = visible
            && (row.stale
                || matches!(
                    row.state,
                    LoadState::Idle | LoadState::Evicted | LoadState::Failed(_)
                ));
        if should_load {
            row.state = LoadState::Loading;
        }
        let mut next = (*self.snapshot).clone();
        next.directories.insert(path.clone(), Arc::new(row));
        self.snapshot = Arc::new(next);
        if should_load {
            self.emit(FileBrowserOutput::DirectoryRequested {
                workspace: self.snapshot.workspace.clone(),
                path: path.clone(),
                cursor: None,
                generation: self
                    .snapshot
                    .directories
                    .get(path)
                    .map_or(0, |row| row.generation),
            });
        }
    }
    pub fn directory_load_more(&mut self, path: &RelativeDirectoryPath) {
        let Some(directory) = self.snapshot.directories.get(path) else {
            return;
        };
        if directory.state == LoadState::Loading {
            return;
        }
        let Some(cursor) = directory.next_cursor.clone() else {
            return;
        };
        let generation = directory.generation;
        let mut next = (*self.snapshot).clone();
        let mut row = (**directory).clone();
        row.state = LoadState::Loading;
        next.directories.insert(path.clone(), Arc::new(row));
        self.snapshot = Arc::new(next);
        self.emit(FileBrowserOutput::DirectoryRequested {
            workspace: self.snapshot.workspace.clone(),
            path: path.clone(),
            cursor: Some(cursor),
            generation,
        });
    }
    pub fn authoritative(&mut self) -> FileBrowserWriter<'_> {
        FileBrowserWriter { store: self }
    }
}

pub struct FileBrowserWriter<'a> {
    store: &'a mut FileBrowserStore,
}
impl FileBrowserWriter<'_> {
    pub fn availability_replace(&mut self, availability: FileAvailability) {
        if self.store.snapshot.availability == availability {
            return;
        }
        let mut next = (*self.store.snapshot).clone();
        next.availability = availability;
        self.store.snapshot = Arc::new(next);
    }
    pub fn search_replace(&mut self, query: &str, files: Vec<FileMatch>) {
        if self.store.snapshot.query.as_ref() != query {
            return;
        }
        let mut next = (*self.store.snapshot).clone();
        next.search_state = LoadState::Ready;
        next.matches = files.into_iter().map(Arc::new).collect();
        self.store.snapshot = Arc::new(next);
    }
    pub fn search_fail(&mut self, query: &str, message: impl Into<Arc<str>>) {
        if self.store.snapshot.query.as_ref() != query {
            return;
        }
        let mut next = (*self.store.snapshot).clone();
        next.search_state = LoadState::Failed(message.into());
        self.store.snapshot = Arc::new(next);
    }
    pub fn directory_replace(
        &mut self,
        path: &RelativeDirectoryPath,
        cursor: Option<&str>,
        entries: Vec<FileTreeEntry>,
        next_cursor: Option<String>,
        generation: u64,
    ) {
        let Some(current) = self.store.snapshot.directories.get(path) else {
            return;
        };
        if current.generation != generation
            || (current.next_cursor.as_deref() != cursor && cursor.is_some())
        {
            return;
        }
        let mut row = (**current).clone();
        if cursor.is_none() {
            row.entries.clear();
        }
        let entries_elsewhere: usize = self
            .store
            .snapshot
            .directories
            .iter()
            .filter(|(other, _)| *other != path)
            .map(|(_, directory)| directory.entries.len())
            .sum();
        let remaining = MAX_ENTRY_COUNT.saturating_sub(entries_elsewhere + row.entries.len());
        let truncated = entries.len() > remaining;
        row.entries
            .extend(entries.into_iter().take(remaining).map(Arc::new));
        row.entries_truncated = truncated;
        row.next_cursor = if truncated {
            None
        } else {
            next_cursor.map(Arc::from)
        };
        row.state = LoadState::Ready;
        row.stale = false;
        let mut next = (*self.store.snapshot).clone();
        next.directories.insert(path.clone(), Arc::new(row));
        self.store.snapshot = Arc::new(next);
    }
    pub fn directory_fail(
        &mut self,
        path: &RelativeDirectoryPath,
        generation: u64,
        message: impl Into<Arc<str>>,
    ) {
        let Some(current) = self.store.snapshot.directories.get(path) else {
            return;
        };
        if current.generation != generation {
            return;
        }
        let mut row = (**current).clone();
        row.state = LoadState::Failed(message.into());
        row.stale = false;
        let mut next = (*self.store.snapshot).clone();
        next.directories.insert(path.clone(), Arc::new(row));
        self.store.snapshot = Arc::new(next);
    }
    /// Marks only already-materialized directories. Returns the exact paths to re-read.
    pub fn invalidated(
        &mut self,
        paths: Option<&[RelativeFilePath]>,
    ) -> Vec<RelativeDirectoryPath> {
        let mut requested = Vec::new();
        let mut next = (*self.store.snapshot).clone();
        for (path, current) in &self.store.snapshot.directories {
            let affected = paths.is_none()
                || paths.is_some_and(|files| {
                    files
                        .iter()
                        .any(|file| parent(file.as_str()) == path.as_str())
                });
            if affected {
                let mut row = (**current).clone();
                row.stale = true;
                row.generation = row.generation.saturating_add(1);
                if current.visible {
                    row.state = LoadState::Loading;
                    requested.push(path.clone());
                }
                next.directories.insert(path.clone(), Arc::new(row));
            }
        }
        self.store.snapshot = Arc::new(next);
        requested
    }
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DocumentPayload {
    EditableText(Arc<str>),
    ReadOnlyText(Arc<str>),
    Binary(Arc<[u8]>),
}
impl DocumentPayload {
    pub fn byte_len(&self) -> usize {
        match self {
            Self::EditableText(v) | Self::ReadOnlyText(v) => v.len(),
            Self::Binary(v) => v.len(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileRevisionSnapshot {
    pub revision: Arc<str>,
    pub state: LoadState,
    pub payload: Option<DocumentPayload>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileConflict {
    pub message: Arc<str>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileDocumentSnapshot {
    pub workspace: FileWorkspaceId,
    pub path: RelativeFilePath,
    pub availability: FileAvailability,
    pub state: LoadState,
    pub payload: Option<DocumentPayload>,
    pub authoritative_hash: Option<Arc<str>>,
    pub draft: Option<Arc<str>>,
    pub draft_revision: u64,
    pub saving_revision: Option<u64>,
    pub stale: bool,
    pub error: Option<Arc<str>>,
    pub conflict: Option<FileConflict>,
    pub revisions: BTreeMap<Arc<str>, Arc<FileRevisionSnapshot>>,
    pub retained: bool,
    pub visible: bool,
    pub staged_hash: Option<Arc<str>>,
    pub generation: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileDocumentOutput {
    DocumentRequested {
        workspace: FileWorkspaceId,
        path: RelativeFilePath,
        generation: u64,
    },
    TextSaveRequested {
        workspace: FileWorkspaceId,
        path: RelativeFilePath,
        text: Arc<str>,
        expected_hash: Option<Arc<str>>,
        revision: u64,
    },
    RevisionRequested {
        workspace: FileWorkspaceId,
        path: RelativeFilePath,
        revision: Arc<str>,
    },
    RetentionChanged {
        workspace: FileWorkspaceId,
        path: RelativeFilePath,
        retained: bool,
    },
    VisibilityChanged {
        workspace: FileWorkspaceId,
        path: RelativeFilePath,
        visible: bool,
    },
    PayloadReleasedAfterStaging {
        workspace: FileWorkspaceId,
        path: RelativeFilePath,
        expected_hash: Arc<str>,
    },
}
type DocumentListener = Arc<dyn Fn(FileDocumentOutput) -> FileOutputAdmission + Send + Sync>;

pub struct FileDocumentStore {
    snapshot: Arc<FileDocumentSnapshot>,
    listener: DocumentListener,
}
impl FileDocumentStore {
    pub fn new(workspace: FileWorkspaceId, path: RelativeFilePath) -> Self {
        Self::with_listener(workspace, path, |_| {})
    }
    pub fn with_listener(
        workspace: FileWorkspaceId,
        path: RelativeFilePath,
        listener: impl Fn(FileDocumentOutput) + Send + Sync + 'static,
    ) -> Self {
        Self::with_admission_listener(workspace, path, move |output| {
            listener(output);
            FileOutputAdmission::Accepted
        })
    }
    pub(crate) fn with_admission_listener(
        workspace: FileWorkspaceId,
        path: RelativeFilePath,
        listener: impl Fn(FileDocumentOutput) -> FileOutputAdmission + Send + Sync + 'static,
    ) -> Self {
        Self {
            snapshot: Arc::new(FileDocumentSnapshot {
                workspace,
                path,
                availability: FileAvailability::Offline,
                state: LoadState::Idle,
                payload: None,
                authoritative_hash: None,
                draft: None,
                draft_revision: 0,
                saving_revision: None,
                stale: false,
                error: None,
                conflict: None,
                revisions: BTreeMap::new(),
                retained: false,
                visible: false,
                staged_hash: None,
                generation: 0,
            }),
            listener: Arc::new(listener),
        }
    }
    fn emit(&mut self, output: FileDocumentOutput) {
        if (self.listener)(output.clone()) == FileOutputAdmission::Accepted {
            return;
        }
        match output {
            FileDocumentOutput::DocumentRequested { generation, .. } => self
                .authoritative()
                .load_fail(generation, OUTPUT_REJECTED_MESSAGE),
            FileDocumentOutput::TextSaveRequested { revision, .. } => self
                .authoritative()
                .save_failed(revision, OUTPUT_REJECTED_MESSAGE),
            FileDocumentOutput::RevisionRequested { revision, .. } => self
                .authoritative()
                .revision_fail(&revision, OUTPUT_REJECTED_MESSAGE),
            FileDocumentOutput::VisibilityChanged { visible: true, .. }
                if self.snapshot.state == LoadState::Loading =>
            {
                let generation = self.snapshot.generation;
                self.authoritative()
                    .load_fail(generation, OUTPUT_REJECTED_MESSAGE);
            }
            FileDocumentOutput::RetentionChanged { .. }
            | FileDocumentOutput::VisibilityChanged { .. }
            | FileDocumentOutput::PayloadReleasedAfterStaging { .. } => {}
        }
    }
    pub fn snapshot(&self) -> &Arc<FileDocumentSnapshot> {
        &self.snapshot
    }
    pub fn document_load(&mut self) {
        let mut next = (*self.snapshot).clone();
        next.state = LoadState::Loading;
        next.error = None;
        self.snapshot = Arc::new(next);
        self.emit(FileDocumentOutput::DocumentRequested {
            workspace: self.snapshot.workspace.clone(),
            path: self.snapshot.path.clone(),
            generation: self.snapshot.generation,
        });
    }
    /// Local text edits remain available while the daemon is offline.
    pub fn text_update(&mut self, text: impl Into<Arc<str>>) {
        let text = text.into();
        let mut next = (*self.snapshot).clone();
        if text.len() > MAX_EDITOR_BYTES {
            next.error = Some(Arc::from("Text edits are limited to 4 MiB."));
            self.snapshot = Arc::new(next);
            return;
        }
        next.draft = match next.payload.as_ref() {
            Some(DocumentPayload::EditableText(authoritative))
                if authoritative.as_ref() == text.as_ref() =>
            {
                None
            }
            _ => Some(text),
        };
        next.draft_revision = next.draft_revision.saturating_add(1);
        next.error = None;
        if next.draft.is_none() {
            next.conflict = None;
        }
        self.snapshot = Arc::new(next);
    }
    /// Discards only local edit intent. An admitted save remains in flight and
    /// its authoritative result will still reconcile when it arrives.
    pub fn text_revert(&mut self) {
        if self.snapshot.draft.is_none()
            && self.snapshot.error.is_none()
            && self.snapshot.conflict.is_none()
        {
            return;
        }
        let mut next = (*self.snapshot).clone();
        next.draft = None;
        next.draft_revision = next.draft_revision.saturating_add(1);
        next.error = None;
        next.conflict = None;
        self.snapshot = Arc::new(next);
    }
    pub fn text_save(&mut self) {
        if self.snapshot.saving_revision.is_some() {
            return;
        }
        let Some(text) = self.snapshot.draft.clone() else {
            return;
        };
        let revision = self.snapshot.draft_revision;
        let mut next = (*self.snapshot).clone();
        next.saving_revision = Some(revision);
        next.error = None;
        self.snapshot = Arc::new(next);
        self.emit(FileDocumentOutput::TextSaveRequested {
            workspace: self.snapshot.workspace.clone(),
            path: self.snapshot.path.clone(),
            text,
            expected_hash: self.snapshot.authoritative_hash.clone(),
            revision,
        });
    }
    /// Pins authoritative payload while an open tab or selected preview owns it.
    pub fn document_retain(&mut self, retained: bool) {
        if self.snapshot.retained == retained {
            return;
        }
        let mut next = (*self.snapshot).clone();
        next.retained = retained;
        self.snapshot = Arc::new(next);
        self.emit(FileDocumentOutput::RetentionChanged {
            workspace: self.snapshot.workspace.clone(),
            path: self.snapshot.path.clone(),
            retained,
        });
    }
    /// Marks whether this retained document is currently on screen. Visibility
    /// controls revalidation work; retention controls payload eviction.
    pub fn document_visibility_update(&mut self, visible: bool) {
        if self.snapshot.visible == visible {
            return;
        }
        let mut next = (*self.snapshot).clone();
        next.visible = visible;
        if visible
            && (next.stale
                || matches!(
                    next.state,
                    LoadState::Idle | LoadState::Evicted | LoadState::Failed(_)
                ))
        {
            next.state = LoadState::Loading;
        }
        self.snapshot = Arc::new(next);
        self.emit(FileDocumentOutput::VisibilityChanged {
            workspace: self.snapshot.workspace.clone(),
            path: self.snapshot.path.clone(),
            visible,
        });
    }

    /// Releases raw bytes after a native preview has acquired its staged-file lease.
    /// Retention stays active so the staged lease, tab identity, and any draft survive.
    pub fn payload_release_after_staging(&mut self, expected_hash: impl Into<Arc<str>>) {
        let expected_hash = expected_hash.into();
        if self.snapshot.payload.is_none()
            || self.snapshot.authoritative_hash.as_deref() != Some(expected_hash.as_ref())
        {
            return;
        }
        let mut next = (*self.snapshot).clone();
        next.payload = None;
        next.state = LoadState::Staged;
        next.staged_hash = Some(expected_hash.clone());
        self.snapshot = Arc::new(next);
        self.emit(FileDocumentOutput::PayloadReleasedAfterStaging {
            workspace: self.snapshot.workspace.clone(),
            path: self.snapshot.path.clone(),
            expected_hash,
        });
    }

    pub fn revision_load(&mut self, revision: impl Into<Arc<str>>) {
        let revision = revision.into();
        if revision.is_empty() || revision.len() > MAX_REVISION_BYTES {
            return;
        }
        let mut next = (*self.snapshot).clone();
        if next.revisions.len() >= 48 && !next.revisions.contains_key(&revision) {
            if let Some(old) = next
                .revisions
                .iter()
                .find(|(_, row)| row.state != LoadState::Loading)
                .map(|(key, _)| key.clone())
            {
                next.revisions.remove(&old);
            } else {
                return;
            }
        }
        next.revisions.insert(
            revision.clone(),
            Arc::new(FileRevisionSnapshot {
                revision: revision.clone(),
                state: LoadState::Loading,
                payload: None,
            }),
        );
        self.snapshot = Arc::new(next);
        self.emit(FileDocumentOutput::RevisionRequested {
            workspace: self.snapshot.workspace.clone(),
            path: self.snapshot.path.clone(),
            revision,
        });
    }
    pub fn authoritative(&mut self) -> FileDocumentWriter<'_> {
        FileDocumentWriter { store: self }
    }
}

pub struct FileDocumentWriter<'a> {
    store: &'a mut FileDocumentStore,
}
impl FileDocumentWriter<'_> {
    pub fn availability_replace(&mut self, availability: FileAvailability) {
        if self.store.snapshot.availability != availability {
            let mut next = (*self.store.snapshot).clone();
            next.availability = availability;
            self.store.snapshot = Arc::new(next);
        }
    }
    pub fn content_replace(
        &mut self,
        payload: DocumentPayload,
        hash: impl Into<Arc<str>>,
        generation: u64,
    ) {
        if self.store.snapshot.generation != generation {
            return;
        }
        let hash = hash.into();
        let mut next = (*self.store.snapshot).clone();
        if next.staged_hash.as_deref() != Some(hash.as_ref()) {
            next.staged_hash = None;
        }
        if let DocumentPayload::EditableText(authoritative) = &payload
            && next.draft.as_deref() == Some(authoritative.as_ref())
        {
            next.draft = None;
            next.conflict = None;
        }
        next.payload = Some(payload);
        next.authoritative_hash = Some(hash);
        next.state = LoadState::Ready;
        next.stale = false;
        next.error = None;
        if next.draft.is_none() {
            next.saving_revision = None;
        }
        self.store.snapshot = Arc::new(next);
    }
    pub fn load_fail(&mut self, generation: u64, message: impl Into<Arc<str>>) {
        if self.store.snapshot.generation != generation {
            return;
        }
        let mut next = (*self.store.snapshot).clone();
        next.state = LoadState::Failed(message.into());
        next.stale = false;
        self.store.snapshot = Arc::new(next);
    }
    pub fn save_succeeded(&mut self, revision: u64, text: Arc<str>, hash: impl Into<Arc<str>>) {
        if self.store.snapshot.saving_revision != Some(revision) {
            return;
        }
        let hash = hash.into();
        let mut next = (*self.store.snapshot).clone();
        if next.staged_hash.as_deref() != Some(hash.as_ref()) {
            next.staged_hash = None;
        }
        next.payload = Some(DocumentPayload::EditableText(text));
        next.authoritative_hash = Some(hash);
        next.saving_revision = None;
        next.error = None;
        next.conflict = None;
        next.state = LoadState::Ready;
        next.stale = false;
        if next.draft_revision == revision {
            next.draft = None;
        }
        self.store.snapshot = Arc::new(next);
    }
    /// A CAS or transport failure never clears the draft.
    pub fn save_failed(&mut self, revision: u64, message: impl Into<Arc<str>>) {
        if self.store.snapshot.saving_revision != Some(revision) {
            return;
        }
        let mut next = (*self.store.snapshot).clone();
        next.saving_revision = None;
        next.error = Some(message.into());
        self.store.snapshot = Arc::new(next);
    }
    pub fn save_conflicted(&mut self, revision: u64, message: impl Into<Arc<str>>) {
        if self.store.snapshot.saving_revision != Some(revision) {
            return;
        }
        let mut next = (*self.store.snapshot).clone();
        next.saving_revision = None;
        next.conflict = Some(FileConflict {
            message: message.into(),
        });
        self.store.snapshot = Arc::new(next);
    }
    pub fn revision_replace(&mut self, revision: &str, payload: DocumentPayload) {
        let Some(current) = self.store.snapshot.revisions.get(revision) else {
            return;
        };
        if current.state != LoadState::Loading {
            return;
        }
        let revision_key: Arc<str> = Arc::from(revision);
        let mut next = (*self.store.snapshot).clone();
        next.revisions.insert(
            revision_key.clone(),
            Arc::new(FileRevisionSnapshot {
                revision: revision_key,
                state: LoadState::Ready,
                payload: Some(payload),
            }),
        );
        self.store.snapshot = Arc::new(next);
    }
    pub fn revision_fail(&mut self, revision: &str, message: impl Into<Arc<str>>) {
        if !self.store.snapshot.revisions.contains_key(revision) {
            return;
        }
        let revision_key: Arc<str> = Arc::from(revision);
        let mut next = (*self.store.snapshot).clone();
        next.revisions.insert(
            revision_key.clone(),
            Arc::new(FileRevisionSnapshot {
                revision: revision_key,
                state: LoadState::Failed(message.into()),
                payload: None,
            }),
        );
        self.store.snapshot = Arc::new(next);
    }
    pub fn revision_evict(&mut self, revision: &str) {
        let Some(current) = self.store.snapshot.revisions.get(revision) else {
            return;
        };
        if current.payload.is_none() {
            return;
        }
        let revision_key: Arc<str> = Arc::from(revision);
        let mut row = (**current).clone();
        row.payload = None;
        row.state = LoadState::Evicted;
        let mut next = (*self.store.snapshot).clone();
        next.revisions.insert(revision_key, Arc::new(row));
        self.store.snapshot = Arc::new(next);
    }
    pub fn invalidated(&mut self) -> bool {
        let mut next = (*self.store.snapshot).clone();
        next.stale = true;
        next.generation = next.generation.saturating_add(1);
        if next.visible {
            next.state = LoadState::Loading;
        }
        next.staged_hash = None;
        self.store.snapshot = Arc::new(next);
        true
    }
    pub fn payload_evict(&mut self) {
        if self.store.snapshot.payload.is_none() {
            return;
        }
        let mut next = (*self.store.snapshot).clone();
        next.payload = None;
        next.state = LoadState::Evicted;
        self.store.snapshot = Arc::new(next);
    }
}
