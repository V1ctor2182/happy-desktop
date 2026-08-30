//! Stable GPUI-owned Happy Agent lifetimes.
//!
//! Transport availability is mutable state on a long-lived entity. A route
//! failure never replaces its namespace, authoritative snapshot, or entity ID.

use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    sync::Arc,
};

use gpui::{AppContext, Context, Entity};

use crate::files::{
    DocumentPayload, FileAvailability, FileBrowserOutput, FileBrowserStore, FileDocumentOutput,
    FileDocumentStore, FileEvent, FileOperation, FileOutputAdmission, FileRequestId,
    FileRevisionQuery, FileSearchQuery, FileTransport, FileTreeQuery, FileWorkspaceId, LoadState,
    MAX_EDITOR_BYTES, RelativeDirectoryPath, RelativeFilePath,
};

use crate::chat::{
    AgentAvailability as ChatAvailability, ChatStore, WorkspacePersistence, WorkspaceStore,
};

#[allow(unused_imports)] // Public state projection; shell adoption removes this allowance.
pub use super::transport::{
    MutationId, OnboardingMutationKind, OnboardingProviderId, ProviderAuthenticationState,
    ProviderOnboardingRow,
};
use super::{
    AgentCatalogStore, ConversationKey, DesktopBootstrap, EventHintPayload, GitState,
    HappyAgentEventType, HostTransport, TransportOptions, UserError, UserErrorKind, WorkerEvent,
    WorkspaceKey, start_host_transport,
};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AgentNamespace(Arc<str>);

impl AgentNamespace {
    pub fn local_host() -> Self {
        Self(Arc::from("host:local"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentAvailability {
    Connecting,
    Online,
    Draining {
        message: String,
    },
    Reconnecting {
        attempt: u32,
        error: Option<UserError>,
    },
    Offline {
        error: UserError,
    },
    Error {
        error: UserError,
    },
}

pub struct AgentLifetime {
    namespace: AgentNamespace,
    availability: AgentAvailability,
    daemon_version: Option<String>,
    snapshot: Option<Arc<DesktopBootstrap>>,
    git: Arc<BTreeMap<String, GitState>>,
    catalog: Entity<AgentCatalogStore>,
    workspaces: BTreeMap<WorkspaceKey, Entity<WorkspaceStore>>,
    chats: BTreeMap<ConversationKey, Entity<ChatStore>>,
    file_browsers: BTreeMap<String, Entity<FileBrowserStore>>,
    file_documents: BTreeMap<(String, RelativeFilePath), Entity<FileDocumentStore>>,
}

impl AgentLifetime {
    fn local(catalog: Entity<AgentCatalogStore>) -> Self {
        Self {
            namespace: AgentNamespace::local_host(),
            availability: AgentAvailability::Connecting,
            daemon_version: None,
            snapshot: None,
            git: Arc::new(BTreeMap::new()),
            catalog,
            workspaces: BTreeMap::new(),
            chats: BTreeMap::new(),
            file_browsers: BTreeMap::new(),
            file_documents: BTreeMap::new(),
        }
    }

    pub fn namespace(&self) -> &AgentNamespace {
        &self.namespace
    }

    pub fn availability(&self) -> &AgentAvailability {
        &self.availability
    }

    #[allow(dead_code)] // Phase 4 projects the connected daemon in navigation.
    pub fn daemon_version(&self) -> Option<&str> {
        self.daemon_version.as_deref()
    }

    #[allow(dead_code)] // Phase 4 projects the catalog without replacing this entity.
    pub fn snapshot(&self) -> Option<&Arc<DesktopBootstrap>> {
        self.snapshot.as_ref()
    }

    pub fn git(&self) -> &Arc<BTreeMap<String, GitState>> {
        &self.git
    }

    pub fn catalog(&self) -> &Entity<AgentCatalogStore> {
        &self.catalog
    }

    pub fn workspace(&self, key: &WorkspaceKey) -> Option<&Entity<WorkspaceStore>> {
        self.workspaces.get(key)
    }

    pub fn chat(&self, key: &ConversationKey) -> Option<&Entity<ChatStore>> {
        self.chats.get(key)
    }

    pub fn materialized_workspaces(
        &self,
    ) -> impl Iterator<Item = (&WorkspaceKey, &Entity<WorkspaceStore>)> {
        self.workspaces.iter()
    }

    pub fn materialized_chats(
        &self,
    ) -> impl Iterator<Item = (&ConversationKey, &Entity<ChatStore>)> {
        self.chats.iter()
    }

    pub fn file_browser(&self, workspace_id: &str) -> Option<&Entity<FileBrowserStore>> {
        self.file_browsers.get(workspace_id)
    }
    pub fn file_document(
        &self,
        workspace_id: &str,
        path: &RelativeFilePath,
    ) -> Option<&Entity<FileDocumentStore>> {
        self.file_documents
            .get(&(workspace_id.to_owned(), path.clone()))
    }
    pub fn materialized_file_browsers(
        &self,
    ) -> impl Iterator<Item = (&String, &Entity<FileBrowserStore>)> {
        self.file_browsers.iter()
    }
    pub fn materialized_file_documents(
        &self,
    ) -> impl Iterator<Item = (&(String, RelativeFilePath), &Entity<FileDocumentStore>)> {
        self.file_documents.iter()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum InitialPhase {
    Checking,
    AgentMissing {
        message: String,
        installable: bool,
    },
    Starting {
        message: String,
    },
    Installing {
        message: String,
        fraction: Option<f32>,
    },
    Connecting,
    ProvidersMissing,
    ProfileRequired,
    FirstProject,
    CompletionRequired,
    Failed {
        message: String,
        retry: InitialRetry,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitialRetry {
    Transport,
    Install,
}

/// Stable membership for every host-published Happy Agent namespace.
///
/// Protocol v23 publishes no peer-route contract, so Phase 3 can authoritatively
/// materialize only the direct local host. Future peer entries must be inserted
/// from that typed host contract, never from endpoint discovery or user input.
pub struct AgentRegistry {
    host_namespace: AgentNamespace,
    lifetimes: BTreeMap<AgentNamespace, Entity<AgentLifetime>>,
}

impl AgentRegistry {
    fn new(cx: &mut Context<ConnectivityController>) -> Self {
        let host_namespace = AgentNamespace::local_host();
        let catalog_namespace = host_namespace.clone();
        let catalog = cx.new(move |_| AgentCatalogStore::new(catalog_namespace));
        let host = cx.new(|_| AgentLifetime::local(catalog));
        let mut lifetimes = BTreeMap::new();
        lifetimes.insert(host_namespace.clone(), host);
        Self {
            host_namespace,
            lifetimes,
        }
    }

    pub fn host(&self) -> &Entity<AgentLifetime> {
        self.lifetimes
            .get(&self.host_namespace)
            .expect("the direct host lifetime is permanent")
    }

    #[allow(dead_code)] // Consumed when protocol v23 gains typed peer routes.
    pub fn known(&self) -> impl Iterator<Item = (&AgentNamespace, &Entity<AgentLifetime>)> {
        self.lifetimes.iter()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingOnboardingMutation {
    pub id: MutationId,
    pub kind: OnboardingMutationKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OnboardingMutationFailure {
    pub id: MutationId,
    pub kind: OnboardingMutationKind,
    pub error: UserError,
}

#[derive(Clone, Debug)]
enum FileStoreOutput {
    Browser(FileBrowserOutput),
    Document(FileDocumentOutput),
}

#[derive(Clone, Debug)]
enum FileRequestProvenance {
    Search {
        workspace: String,
        query: String,
    },
    Tree {
        workspace: String,
        path: RelativeDirectoryPath,
        cursor: Option<String>,
        generation: u64,
    },
    Read {
        workspace: String,
        path: RelativeFilePath,
        generation: u64,
    },
    Write {
        workspace: String,
        path: RelativeFilePath,
        revision: u64,
    },
    Revision {
        workspace: String,
        path: RelativeFilePath,
        revision: Arc<str>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum FileCacheKey {
    Current(String, RelativeFilePath),
    Revision(String, RelativeFilePath, Arc<str>),
}

pub struct ConnectivityController {
    agents: AgentRegistry,
    transport: Option<HostTransport>,
    initial_phase: InitialPhase,
    onboarding_failure: Option<OnboardingMutationFailure>,
    pending_mutation: Option<PendingOnboardingMutation>,
    provider_rows: Vec<ProviderOnboardingRow>,
    providers_continue_required: bool,
    profile_version: Option<String>,
    profile_name: Option<String>,
    profile_email: Option<String>,
    setup_owed: Option<bool>,
    live_mutations: bool,
    mounted: bool,
    chat: super::chat_state::ChatConnectivity,
    files: Arc<FileTransport>,
    file_output_tx: async_channel::Sender<FileStoreOutput>,
    file_provenance: HashMap<FileRequestId, FileRequestProvenance>,
    file_cache_order: VecDeque<FileCacheKey>,
    workspace_persistence: Option<WorkspacePersistence>,
    workspace_persistence_error: Option<Arc<str>>,
    workspace_persistence_error_workspace: Option<WorkspaceKey>,
}

impl ConnectivityController {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let transport = start_host_transport(TransportOptions::default());
        let receiver = transport.receiver();
        let chat_transport = Arc::new(super::start_chat_transport(TransportOptions::default()));
        let chat_receiver = chat_transport.receiver();
        let chat = super::chat_state::ChatConnectivity::new(Arc::clone(&chat_transport));
        let output_receiver = chat.output_rx.clone();
        let files = Arc::new(crate::files::start_file_transport(
            TransportOptions::default(),
        ));
        let file_receiver = files.receiver();
        let (file_output_tx, file_output_receiver) =
            async_channel::bounded(crate::files::MAX_PENDING_REQUESTS);
        let agents = AgentRegistry::new(cx);
        cx.spawn(async move |this, cx| {
            while let Ok(event) = receiver.recv().await {
                let stopped = matches!(event, WorkerEvent::Stopped);
                if this
                    .update(cx, |controller, cx| controller.apply(event, cx))
                    .is_err()
                    || stopped
                {
                    break;
                }
            }
        })
        .detach();
        cx.spawn(async move |this, cx| {
            while let Ok(event) = chat_receiver.recv().await {
                let stopped = matches!(event, super::ChatEvent::Stopped);
                if this
                    .update(cx, |controller, cx| controller.apply_chat_event(event, cx))
                    .is_err()
                    || stopped
                {
                    break;
                }
            }
        })
        .detach();
        cx.spawn(async move |this, cx| {
            while let Ok(output) = output_receiver.recv().await {
                if this
                    .update(cx, |controller, cx| {
                        controller.apply_store_output(output, cx)
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        cx.spawn(async move |this, cx| {
            while let Ok(event) = file_receiver.recv().await {
                let stopped = matches!(event, FileEvent::Stopped);
                if this
                    .update(cx, |controller, cx| controller.apply_file_event(event, cx))
                    .is_err()
                    || stopped
                {
                    break;
                }
            }
        })
        .detach();
        cx.spawn(async move |this, cx| {
            while let Ok(output) = file_output_receiver.recv().await {
                if this
                    .update(cx, |controller, cx| {
                        controller.apply_file_output(output, cx)
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        let persistence_root = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from("/dev/null"))
            .join("Library/Application Support/Happy GPUI/workspace-memory");
        let (workspace_persistence, workspace_persistence_error) = match WorkspacePersistence::open(
            persistence_root,
            &AgentNamespace::local_host(),
        ) {
            Ok(persistence) => (Some(persistence), None),
            Err(_) => (
                None,
                Some(Arc::from(
                    "Workspace history and drafts cannot be saved. Check Application Support permissions.",
                )),
            ),
        };
        if let Some(persistence) = &workspace_persistence {
            let persistence_events = persistence.event_receiver();
            cx.spawn(async move |this, cx| {
                while let Ok(event) = persistence_events.recv().await {
                    if this
                        .update(cx, |controller, cx| {
                            match event {
                                crate::chat::WorkspacePersistenceEvent::Saved { workspace } => {
                                    if controller.workspace_persistence_error_workspace.as_ref()
                                        == Some(&workspace)
                                    {
                                        controller.workspace_persistence_error = None;
                                        controller.workspace_persistence_error_workspace = None;
                                    }
                                }
                                crate::chat::WorkspacePersistenceEvent::Failed {
                                    workspace,
                                    message,
                                } => {
                                    controller.workspace_persistence_error = Some(message);
                                    controller.workspace_persistence_error_workspace =
                                        Some(workspace);
                                }
                            }
                            cx.notify();
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            })
            .detach();
        }
        Self {
            agents,
            transport: Some(transport),
            initial_phase: InitialPhase::Checking,
            onboarding_failure: None,
            pending_mutation: None,
            provider_rows: Vec::new(),
            providers_continue_required: false,
            profile_version: None,
            profile_name: None,
            profile_email: None,
            setup_owed: None,
            live_mutations: false,
            mounted: false,
            chat,
            files,
            file_output_tx,
            file_provenance: HashMap::new(),
            file_cache_order: VecDeque::new(),
            workspace_persistence,
            workspace_persistence_error,
            workspace_persistence_error_workspace: None,
        }
    }

    pub fn agents(&self) -> &AgentRegistry {
        &self.agents
    }

    /// Returns the permanent browser store for one host workspace, creating it without opening transport.
    pub fn file_browser_materialize(
        &mut self,
        workspace: &WorkspaceKey,
        cx: &mut Context<Self>,
    ) -> Option<Entity<FileBrowserStore>> {
        if workspace.namespace() != &AgentNamespace::local_host() {
            return None;
        }
        let id = workspace.id().to_owned();
        if let Some(store) = self.agents.host().read(cx).file_browsers.get(&id) {
            return Some(store.clone());
        }
        let sender = self.file_output_tx.clone();
        let availability = self.file_availability(cx);
        let store = cx.new({
            let id = id.clone();
            move |_| {
                let mut store = FileBrowserStore::with_admission_listener(
                    FileWorkspaceId::new(id),
                    move |output| {
                        if sender.try_send(FileStoreOutput::Browser(output)).is_ok() {
                            FileOutputAdmission::Accepted
                        } else {
                            FileOutputAdmission::Rejected
                        }
                    },
                );
                store.authoritative().availability_replace(availability);
                store
            }
        });
        self.agents.host().update(cx, |host, cx| {
            host.file_browsers
                .entry(id)
                .or_insert_with(|| store.clone());
            cx.notify();
        });
        Some(store)
    }

    /// Returns the permanent document store for one `(workspace, relative path)` identity.
    pub fn file_document_materialize(
        &mut self,
        workspace: &WorkspaceKey,
        path: RelativeFilePath,
        cx: &mut Context<Self>,
    ) -> Option<Entity<FileDocumentStore>> {
        if workspace.namespace() != &AgentNamespace::local_host() {
            return None;
        }
        let id = workspace.id().to_owned();
        let key = (id.clone(), path.clone());
        if let Some(store) = self.agents.host().read(cx).file_documents.get(&key) {
            return Some(store.clone());
        }
        let sender = self.file_output_tx.clone();
        let availability = self.file_availability(cx);
        let store = cx.new({
            let id = id.clone();
            let path = path.clone();
            move |_| {
                let mut store = FileDocumentStore::with_admission_listener(
                    FileWorkspaceId::new(id),
                    path,
                    move |output| {
                        if sender.try_send(FileStoreOutput::Document(output)).is_ok() {
                            FileOutputAdmission::Accepted
                        } else {
                            FileOutputAdmission::Rejected
                        }
                    },
                );
                store.authoritative().availability_replace(availability);
                store
            }
        });
        self.agents.host().update(cx, |host, cx| {
            host.file_documents
                .entry(key)
                .or_insert_with(|| store.clone());
            cx.notify();
        });
        Some(store)
    }

    pub fn initial_phase(&self) -> &InitialPhase {
        &self.initial_phase
    }

    pub fn mounted(&self) -> bool {
        self.mounted
    }

    pub fn setup_owed(&self) -> Option<bool> {
        self.setup_owed
    }

    pub fn live_mutations_available(&self) -> bool {
        self.live_mutations
    }

    pub fn retry(&self) {
        if let Some(transport) = &self.transport {
            transport.retry();
        }
    }

    pub fn install_start(&self) {
        if let Some(transport) = &self.transport {
            transport.install_start();
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn onboarding_error(&self) -> Option<&str> {
        self.onboarding_failure
            .as_ref()
            .map(|failure| failure.error.message.as_str())
    }

    pub fn onboarding_failure(&self) -> Option<&OnboardingMutationFailure> {
        self.onboarding_failure.as_ref()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn pending_mutation(&self) -> Option<PendingOnboardingMutation> {
        self.pending_mutation
    }

    pub fn mutation_pending(&self, kind: OnboardingMutationKind) -> bool {
        self.pending_mutation
            .is_some_and(|pending| pending.kind == kind)
    }

    pub fn provider_rows(&self) -> &[ProviderOnboardingRow] {
        &self.provider_rows
    }

    pub fn providers_continue_available(&self) -> bool {
        self.providers_continue_required
            && !self.mutation_pending(OnboardingMutationKind::Providers)
    }

    pub fn profile_defaults(&self) -> (Option<&str>, Option<&str>) {
        (self.profile_name.as_deref(), self.profile_email.as_deref())
    }

    pub fn profile_update(&self, name: String, email: String) -> bool {
        if self.pending_mutation.is_some() || !self.live_mutations {
            return false;
        }
        if let (Some(transport), Some(version)) = (&self.transport, &self.profile_version) {
            return transport.profile_update(name, email, version.clone());
        }
        false
    }

    pub fn providers_scan(&self) -> bool {
        if self.pending_mutation.is_some() || !self.live_mutations {
            return false;
        }
        self.transport
            .as_ref()
            .is_some_and(HostTransport::providers_scan)
    }

    pub fn providers_continue(&mut self) -> bool {
        if !self.providers_continue_available() {
            return false;
        }
        self.providers_continue_required = false;
        self.initial_phase = InitialPhase::FirstProject;
        true
    }

    pub fn project_register(&self, path: std::path::PathBuf) -> bool {
        if self.pending_mutation.is_some() || !self.live_mutations {
            return false;
        }
        self.transport
            .as_ref()
            .is_some_and(|transport| transport.project_register(path))
    }

    pub fn onboarding_complete(&self) -> bool {
        if self.pending_mutation.is_some() || !self.live_mutations {
            return false;
        }
        self.transport
            .as_ref()
            .is_some_and(HostTransport::onboarding_complete)
    }

    #[cfg(test)]
    pub fn fixture_startup(cx: &mut Context<Self>) -> Self {
        Self {
            agents: AgentRegistry::new(cx),
            transport: None,
            initial_phase: InitialPhase::CompletionRequired,
            onboarding_failure: None,
            pending_mutation: None,
            provider_rows: Vec::new(),
            providers_continue_required: false,
            profile_version: None,
            profile_name: None,
            profile_email: None,
            setup_owed: Some(true),
            live_mutations: false,
            mounted: false,
            chat: super::chat_state::ChatConnectivity::new(Arc::new(super::start_chat_transport(
                TransportOptions::default(),
            ))),
            files: Arc::new(crate::files::start_file_transport(
                TransportOptions::default(),
            )),
            file_output_tx: async_channel::bounded(crate::files::MAX_PENDING_REQUESTS).0,
            file_provenance: HashMap::new(),
            file_cache_order: VecDeque::new(),
            workspace_persistence: None,
            workspace_persistence_error: None,
            workspace_persistence_error_workspace: None,
        }
    }

    #[cfg(test)]
    pub fn fixture_mounted(cx: &mut Context<Self>) -> Self {
        let agents = AgentRegistry::new(cx);
        agents.host().update(cx, |host, _| {
            host.availability = AgentAvailability::Online;
        });
        Self {
            agents,
            transport: None,
            initial_phase: InitialPhase::Connecting,
            onboarding_failure: None,
            pending_mutation: None,
            provider_rows: Vec::new(),
            providers_continue_required: false,
            profile_version: None,
            profile_name: None,
            profile_email: None,
            setup_owed: Some(false),
            live_mutations: true,
            mounted: true,
            chat: super::chat_state::ChatConnectivity::new(Arc::new(super::start_chat_transport(
                TransportOptions::default(),
            ))),
            files: Arc::new(crate::files::start_file_transport(
                TransportOptions::default(),
            )),
            file_output_tx: async_channel::bounded(crate::files::MAX_PENDING_REQUESTS).0,
            file_provenance: HashMap::new(),
            file_cache_order: VecDeque::new(),
            workspace_persistence: None,
            workspace_persistence_error: None,
            workspace_persistence_error_workspace: None,
        }
    }

    #[cfg(test)]
    pub fn availability_set(&mut self, availability: AgentAvailability, cx: &mut Context<Self>) {
        self.live_mutations = matches!(availability, AgentAvailability::Online);
        self.agents.host().update(cx, |host, cx| {
            host.availability = availability;
            cx.notify();
        });
        cx.notify();
    }

    fn apply(&mut self, event: WorkerEvent, cx: &mut Context<Self>) {
        if std::env::var_os("HAPPY_GPUI_TRACE_CONNECTIVITY").is_some() {
            eprintln!(
                "connectivity event: {}",
                match &event {
                    WorkerEvent::Checking => "checking",
                    WorkerEvent::AgentMissing { .. } => "agent-missing",
                    WorkerEvent::Starting { .. } => "starting",
                    WorkerEvent::Installing { .. } => "installing",
                    WorkerEvent::Connecting => "connecting",
                    WorkerEvent::Bootstrap { .. } => "bootstrap",
                    WorkerEvent::Reconciled { .. } => "reconciled",
                    WorkerEvent::StreamHello(_) => "stream-hello",
                    WorkerEvent::Draining { .. } => "draining",
                    WorkerEvent::EventHint(_) => "event-hint",
                    WorkerEvent::Reconnecting { .. } => "reconnecting",
                    WorkerEvent::Offline { .. } => "offline",
                    WorkerEvent::Error { .. } => "error",
                    WorkerEvent::OnboardingMutationStarted { .. } => "onboarding-started",
                    WorkerEvent::OnboardingMutationSucceeded { .. } => "onboarding-succeeded",
                    WorkerEvent::OnboardingMutationFailed { .. } => "onboarding-failed",
                    WorkerEvent::InstallFailed { .. } => "install-failed",
                    WorkerEvent::Stopped => "stopped",
                }
            );
            match &event {
                WorkerEvent::Error { error }
                | WorkerEvent::Offline { error }
                | WorkerEvent::OnboardingMutationFailed { error, .. } => {
                    eprintln!("connectivity error: {}", error.message);
                }
                WorkerEvent::InstallFailed { message } => {
                    eprintln!("connectivity install error: {message}");
                }
                WorkerEvent::Reconnecting {
                    error: Some(error), ..
                } => eprintln!("connectivity retry: {}", error.message),
                _ => {}
            }
        }
        match event {
            WorkerEvent::Checking => self.initial_phase = InitialPhase::Checking,
            WorkerEvent::AgentMissing {
                message,
                installable,
            } => {
                if !self.mounted
                    && !matches!(
                        self.initial_phase,
                        InitialPhase::Installing { .. } | InitialPhase::Failed { .. }
                    )
                {
                    self.setup_owed = Some(true);
                    self.initial_phase = InitialPhase::AgentMissing {
                        message,
                        installable,
                    };
                }
            }
            WorkerEvent::Starting { message } => {
                if !self.mounted && !matches!(self.initial_phase, InitialPhase::Failed { .. }) {
                    self.initial_phase = InitialPhase::Starting { message };
                }
            }
            WorkerEvent::Installing {
                message,
                received_bytes,
                total_bytes,
            } => {
                if !self.mounted {
                    let fraction = received_bytes
                        .zip(total_bytes)
                        .filter(|(_, total)| *total > 0)
                        .map(|(received, total)| received as f32 / total as f32);
                    self.initial_phase = InitialPhase::Installing { message, fraction };
                }
            }
            WorkerEvent::Connecting => {
                self.live_mutations = false;
                if !self.mounted
                    && !matches!(
                        self.initial_phase,
                        InitialPhase::AgentMissing { .. }
                            | InitialPhase::Starting { .. }
                            | InitialPhase::Installing { .. }
                            | InitialPhase::Failed { .. }
                    )
                {
                    self.initial_phase = InitialPhase::Connecting;
                }
                self.agents.host().update(cx, |host, cx| {
                    host.availability = AgentAvailability::Connecting;
                    cx.notify();
                });
                self.chat_availability_reconcile(cx);
                self.file_availability_reconcile(cx);
            }
            WorkerEvent::Bootstrap {
                snapshot,
                git,
                daemon_version,
            } => {
                self.accept_snapshot(snapshot, Some(git), Some(daemon_version), cx);
            }
            WorkerEvent::Reconciled { snapshot, git } => {
                self.accept_snapshot(snapshot, git, None, cx);
            }
            WorkerEvent::StreamHello(hello) => {
                let _delivery_position = (hello.cursor, hello.daemon_id);
                let draining = hello.draining == Some(true)
                    || matches!(
                        self.agents.host().read(cx).availability,
                        AgentAvailability::Draining { .. }
                    );
                self.live_mutations = !draining;
                self.agents.host().update(cx, |host, cx| {
                    host.availability = if draining {
                        AgentAvailability::Draining {
                            message: "Happy Agent is draining and accepts no new live mutations."
                                .into(),
                        }
                    } else {
                        AgentAvailability::Online
                    };
                    cx.notify();
                });
                self.chat_availability_reconcile(cx);
                self.file_availability_reconcile(cx);
                self.refresh_focused(cx);
                self.invalidate_all_files(cx);
                // Stream metadata is transport state, never durable product state.
            }
            WorkerEvent::Draining { message } => {
                self.live_mutations = false;
                self.agents.host().update(cx, |host, cx| {
                    host.availability = AgentAvailability::Draining { message };
                    cx.notify();
                });
                self.chat_availability_reconcile(cx);
                self.file_availability_reconcile(cx);
            }
            WorkerEvent::EventHint(hint) => {
                let _delivery_position = hint.cursor;
                if hint.event_type == HappyAgentEventType::FilesUpdated {
                    self.apply_files_hint(hint.payload.as_ref(), cx);
                }
                self.apply_chat_hint(hint.event_type, hint.payload, cx);
                // Delivery hints only schedule authoritative reconciliation of materialized state.
            }
            WorkerEvent::Reconnecting { attempt, error } => {
                self.live_mutations = false;
                self.agents.host().update(cx, |host, cx| {
                    host.availability = AgentAvailability::Reconnecting { attempt, error };
                    cx.notify();
                });
                self.chat_availability_reconcile(cx);
                self.file_availability_reconcile(cx);
            }
            WorkerEvent::Offline { error } => {
                self.live_mutations = false;
                self.agents.host().update(cx, |host, cx| {
                    host.availability = AgentAvailability::Offline { error };
                    cx.notify();
                });
                self.chat_availability_reconcile(cx);
                self.file_availability_reconcile(cx);
            }
            WorkerEvent::Error { error } => {
                self.live_mutations = false;
                if !self.mounted {
                    self.initial_phase = InitialPhase::Failed {
                        message: error.message.clone(),
                        retry: InitialRetry::Transport,
                    };
                }
                self.agents.host().update(cx, |host, cx| {
                    host.availability = AgentAvailability::Error {
                        error: error.clone(),
                    };
                    cx.notify();
                });
                if matches!(error.kind, UserErrorKind::Protocol) {
                    // A protocol refusal is settled until a compatible daemon or app is installed.
                }
                self.chat_availability_reconcile(cx);
                self.file_availability_reconcile(cx);
            }
            WorkerEvent::OnboardingMutationStarted { id, kind } => {
                // The transport admits only one mutation. Keep the state boundary
                // defensive too, so a duplicate start cannot replace provenance.
                if self.pending_mutation.is_some() {
                    cx.notify();
                    return;
                }
                self.pending_mutation = Some(PendingOnboardingMutation { id, kind });
                self.onboarding_failure = None;
            }
            WorkerEvent::OnboardingMutationSucceeded {
                id,
                kind,
                snapshot,
                provider_rows,
            } => {
                if self.pending_mutation != Some(PendingOnboardingMutation { id, kind }) {
                    cx.notify();
                    return;
                }
                self.pending_mutation = None;
                if kind == OnboardingMutationKind::Providers {
                    self.provider_rows = provider_rows.unwrap_or_default();
                    self.providers_continue_required = snapshot.onboarding.steps.providers.done
                        && !snapshot.onboarding.steps.project.done;
                }
                self.accept_snapshot(snapshot, None, None, cx);
            }
            WorkerEvent::OnboardingMutationFailed {
                id,
                kind,
                error,
                snapshot,
            } => {
                if self.pending_mutation != Some(PendingOnboardingMutation { id, kind }) {
                    cx.notify();
                    return;
                }
                self.pending_mutation = None;
                if let Some(snapshot) = snapshot {
                    self.accept_snapshot(snapshot, None, None, cx);
                }
                if self.mutation_matches_phase(kind) {
                    self.onboarding_failure = Some(OnboardingMutationFailure { id, kind, error });
                }
            }
            WorkerEvent::InstallFailed { message } => {
                if !self.mounted {
                    self.initial_phase = InitialPhase::Failed {
                        message,
                        retry: InitialRetry::Install,
                    };
                }
            }
            WorkerEvent::Stopped => {}
        }
        cx.notify();
    }

    fn apply_file_output(&mut self, output: FileStoreOutput, cx: &mut Context<Self>) {
        match output {
            FileStoreOutput::Browser(FileBrowserOutput::SearchRequested { workspace, query }) => {
                let id = workspace.as_str().to_owned();
                match FileSearchQuery::new(query.to_string(), Some(50))
                    .map_err(|error| UserError {
                        kind: UserErrorKind::Protocol,
                        message: error.to_string(),
                        api: None,
                    })
                    .and_then(|request| self.files.search(id.clone(), request))
                {
                    Ok(request) => {
                        self.file_provenance.insert(
                            request,
                            FileRequestProvenance::Search {
                                workspace: id,
                                query: query.to_string(),
                            },
                        );
                    }
                    Err(error) => self.file_browser_fail_search(&id, &query, error.message, cx),
                }
            }
            FileStoreOutput::Browser(FileBrowserOutput::DirectoryRequested {
                workspace,
                path,
                cursor,
                generation,
            }) => {
                let id = workspace.as_str().to_owned();
                let cursor_string = cursor.as_deref().map(str::to_owned);
                match FileTreeQuery::new(path.clone(), cursor_string.clone(), Some(500))
                    .map_err(|error| UserError {
                        kind: UserErrorKind::Protocol,
                        message: error.to_string(),
                        api: None,
                    })
                    .and_then(|query| self.files.tree(id.clone(), query))
                {
                    Ok(request) => {
                        self.file_provenance.insert(
                            request,
                            FileRequestProvenance::Tree {
                                workspace: id,
                                path,
                                cursor: cursor_string,
                                generation,
                            },
                        );
                    }
                    Err(error) => {
                        self.file_browser_fail_directory(&id, &path, generation, error.message, cx)
                    }
                }
            }
            FileStoreOutput::Document(FileDocumentOutput::DocumentRequested {
                workspace,
                path,
                generation,
            }) => {
                let id = workspace.as_str().to_owned();
                match self.files.read(id.clone(), path.clone()) {
                    Ok(request) => {
                        self.file_provenance.insert(
                            request,
                            FileRequestProvenance::Read {
                                workspace: id,
                                path,
                                generation,
                            },
                        );
                    }
                    Err(error) => {
                        self.file_document_load_fail(&id, &path, generation, error.message, cx)
                    }
                }
            }
            FileStoreOutput::Document(FileDocumentOutput::TextSaveRequested {
                workspace,
                path,
                text,
                expected_hash,
                revision,
            }) => {
                let id = workspace.as_str().to_owned();
                match self
                    .files
                    .write_text(id.clone(), path.clone(), text, expected_hash, revision)
                {
                    Ok(request) => {
                        self.file_provenance.insert(
                            request,
                            FileRequestProvenance::Write {
                                workspace: id,
                                path,
                                revision,
                            },
                        );
                    }
                    Err(error) => {
                        self.file_document_save_fail(&id, &path, revision, error.message, cx)
                    }
                }
            }
            FileStoreOutput::Document(FileDocumentOutput::PayloadReleasedAfterStaging {
                workspace,
                path,
                expected_hash: _,
            }) => {
                let workspace = workspace.as_str().to_owned();
                self.file_cache_order.retain(|key| match key {
                    FileCacheKey::Current(id, item) => id != &workspace || item != &path,
                    FileCacheKey::Revision(_, _, _) => true,
                });
            }
            FileStoreOutput::Document(FileDocumentOutput::VisibilityChanged {
                workspace,
                path,
                visible,
            }) => {
                if visible {
                    let workspace = workspace.as_str().to_owned();
                    if self
                        .host_file_document(&workspace, &path, cx)
                        .is_some_and(|store| {
                            let snapshot = store.read(cx).snapshot();
                            snapshot.stale
                                || (snapshot.payload.is_none()
                                    && matches!(snapshot.state, LoadState::Loading))
                        })
                    {
                        self.request_stale_read(workspace, path, cx);
                    }
                }
            }
            FileStoreOutput::Document(FileDocumentOutput::RetentionChanged {
                workspace,
                path,
                retained,
            }) => {
                let workspace = workspace.as_str().to_owned();
                self.file_cache_retention_changed(workspace, path, retained, cx);
            }
            FileStoreOutput::Document(FileDocumentOutput::RevisionRequested {
                workspace,
                path,
                revision,
            }) => {
                let id = workspace.as_str().to_owned();
                match FileRevisionQuery::new(path.clone(), revision.to_string())
                    .map_err(|error| UserError {
                        kind: UserErrorKind::Protocol,
                        message: error.to_string(),
                        api: None,
                    })
                    .and_then(|query| self.files.revision(id.clone(), query))
                {
                    Ok(request) => {
                        self.file_provenance.insert(
                            request,
                            FileRequestProvenance::Revision {
                                workspace: id,
                                path,
                                revision,
                            },
                        );
                    }
                    Err(error) => {
                        self.file_document_revision_fail(&id, &path, &revision, error.message, cx)
                    }
                }
            }
        }
        cx.notify();
    }

    fn apply_file_event(&mut self, event: FileEvent, cx: &mut Context<Self>) {
        match event {
            FileEvent::SearchReady {
                request_id,
                workspace_id,
                query,
                response,
            } => {
                if matches!(self.file_provenance.remove(&request_id),Some(FileRequestProvenance::Search{workspace,query:expected}) if workspace==workspace_id && expected==query)
                {
                    if let Some(store) = self.host_file_browser(&workspace_id, cx) {
                        store.update(cx, |store, cx| {
                            store.authoritative().search_replace(&query, response.files);
                            cx.notify();
                        });
                    }
                }
            }
            FileEvent::TreeReady {
                request_id,
                workspace_id,
                query,
                response,
            } => {
                let generation = match self.file_provenance.remove(&request_id) {
                    Some(FileRequestProvenance::Tree {
                        workspace,
                        path,
                        cursor,
                        generation,
                    }) if workspace == workspace_id
                        && path == query.path
                        && cursor == query.cursor =>
                    {
                        Some(generation)
                    }
                    _ => None,
                };
                if let Some(generation) = generation
                    && let Some(store) = self.host_file_browser(&workspace_id, cx)
                {
                    store.update(cx, |store, cx| {
                        store.authoritative().directory_replace(
                            &query.path,
                            query.cursor.as_deref(),
                            response.entries,
                            response.next_cursor,
                            generation,
                        );
                        cx.notify();
                    });
                }
            }
            FileEvent::FileReady {
                request_id,
                workspace_id,
                path,
                bytes,
                hash,
            } => {
                let generation = match self.file_provenance.remove(&request_id) {
                    Some(FileRequestProvenance::Read {
                        workspace,
                        path: expected_path,
                        generation,
                    }) if workspace == workspace_id && expected_path == path => Some(generation),
                    _ => None,
                };
                if let Some(generation) = generation {
                    match file_payload(bytes) {
                        Ok(payload) => {
                            if let Some(store) = self.host_file_document(&workspace_id, &path, cx)
                                && store.read(cx).snapshot().generation == generation
                            {
                                store.update(cx, |store, cx| {
                                    store
                                        .authoritative()
                                        .content_replace(payload, hash, generation);
                                    cx.notify();
                                });
                                self.file_cache_touch(
                                    FileCacheKey::Current(workspace_id, path),
                                    cx,
                                );
                            }
                        }
                        Err(message) => self.file_document_load_fail(
                            &workspace_id,
                            &path,
                            generation,
                            message,
                            cx,
                        ),
                    }
                }
            }
            FileEvent::FileWritten {
                request_id,
                workspace_id,
                path,
                revision,
                text,
                hash,
            } => {
                let accepted = matches!(self.file_provenance.remove(&request_id), Some(FileRequestProvenance::Write { workspace, path: expected_path, revision: expected }) if workspace == workspace_id && expected_path == path && expected == revision);
                if accepted {
                    if let Some(store) = self.host_file_document(&workspace_id, &path, cx) {
                        store.update(cx, |store, cx| {
                            store.authoritative().save_succeeded(revision, text, hash);
                            cx.notify();
                        });
                        self.file_cache_touch(FileCacheKey::Current(workspace_id, path), cx);
                    }
                }
            }
            FileEvent::RevisionReady {
                request_id,
                workspace_id,
                query,
                bytes,
            } => {
                let accepted = matches!(
                    self.file_provenance.remove(&request_id),
                    Some(FileRequestProvenance::Revision { workspace, path, revision })
                        if workspace == workspace_id && path == query.path && revision.as_ref() == query.revision
                );
                if accepted {
                    match file_payload(bytes) {
                        Ok(payload) => {
                            if let Some(store) =
                                self.host_file_document(&workspace_id, &query.path, cx)
                            {
                                store.update(cx, |store, cx| {
                                    store
                                        .authoritative()
                                        .revision_replace(&query.revision, payload);
                                    cx.notify();
                                });
                                self.file_cache_touch(
                                    FileCacheKey::Revision(
                                        workspace_id,
                                        query.path,
                                        Arc::from(query.revision),
                                    ),
                                    cx,
                                );
                            }
                        }
                        Err(message) => self.file_document_revision_fail(
                            &workspace_id,
                            &query.path,
                            &query.revision,
                            message,
                            cx,
                        ),
                    }
                }
            }
            FileEvent::Failed {
                request_id,
                operation,
                workspace_id,
                path: _,
                revision,
                error,
            } => {
                let provenance = self.file_provenance.remove(&request_id);
                match (operation, provenance) {
                    (FileOperation::Search, Some(FileRequestProvenance::Search { query, .. })) => {
                        self.file_browser_fail_search(&workspace_id, &query, error.message, cx)
                    }
                    (
                        FileOperation::Tree,
                        Some(FileRequestProvenance::Tree {
                            path, generation, ..
                        }),
                    ) => self.file_browser_fail_directory(
                        &workspace_id,
                        &path,
                        generation,
                        error.message,
                        cx,
                    ),
                    (
                        FileOperation::Read,
                        Some(FileRequestProvenance::Read {
                            path, generation, ..
                        }),
                    ) => self.file_document_load_fail(
                        &workspace_id,
                        &path,
                        generation,
                        error.message,
                        cx,
                    ),
                    (
                        FileOperation::Write,
                        Some(FileRequestProvenance::Write {
                            path,
                            revision: expected,
                            ..
                        }),
                    ) => {
                        let revision = revision.unwrap_or(expected);
                        if error
                            .api
                            .as_ref()
                            .is_some_and(|api| api.status == 409 || api.status == 412)
                        {
                            self.file_document_save_conflict(
                                &workspace_id,
                                &path,
                                revision,
                                error.message,
                                cx,
                            );
                            if let Some(store) = self.host_file_document(&workspace_id, &path, cx) {
                                store.update(cx, |store, cx| {
                                    store.authoritative().invalidated();
                                    cx.notify();
                                });
                            }
                            self.request_stale_read(workspace_id, path, cx);
                        } else {
                            self.file_document_save_fail(
                                &workspace_id,
                                &path,
                                revision,
                                error.message,
                                cx,
                            );
                        }
                    }
                    (
                        FileOperation::Revision,
                        Some(FileRequestProvenance::Revision { path, revision, .. }),
                    ) => self.file_document_revision_fail(
                        &workspace_id,
                        &path,
                        &revision,
                        error.message,
                        cx,
                    ),
                    _ => {}
                }
            }
            FileEvent::Stopped => {
                self.file_provenance.clear();
            }
        }
        self.refresh_stale_files(cx);
        cx.notify();
    }

    fn apply_files_hint(&mut self, payload: Option<&EventHintPayload>, cx: &mut Context<Self>) {
        let Some(workspace) = payload.and_then(|value| value.workspace_id.as_deref()) else {
            return;
        };
        // `None` means the daemon named the full workspace, or at least one supplied
        // path was invalid. Invalid hint data must broaden, never narrow, revalidation.
        let paths = match payload.and_then(|value| value.paths.as_ref()) {
            Some(values) if values.len() <= crate::files::MAX_ENTRY_COUNT => values
                .iter()
                .map(RelativeFilePath::parse)
                .collect::<Result<Vec<_>, _>>()
                .ok(),
            Some(_) => None,
            None => None,
        };
        if let Some(browser) = self.host_file_browser(workspace, cx) {
            let directories = browser.update(cx, |store, cx| {
                let result = store.authoritative().invalidated(paths.as_deref());
                cx.notify();
                result
            });
            for path in directories {
                self.request_stale_tree(workspace.to_owned(), path, cx);
            }
        }
        let documents: Vec<_> = self
            .agents
            .host()
            .read(cx)
            .file_documents
            .iter()
            .filter(|((id, path), _)| {
                id == workspace && paths.as_ref().map_or(true, |values| values.contains(path))
            })
            .map(|((_, path), store)| {
                (
                    path.clone(),
                    store.clone(),
                    store.read(cx).snapshot().visible,
                )
            })
            .collect();
        for (path, store, visible) in documents {
            store.update(cx, |store, cx| {
                store.authoritative().invalidated();
                cx.notify();
            });
            if visible {
                self.request_stale_read(workspace.to_owned(), path, cx);
            }
        }
    }

    fn invalidate_all_files(&mut self, cx: &mut Context<Self>) {
        let workspace_ids: Vec<_> = self
            .agents
            .host()
            .read(cx)
            .file_browsers
            .keys()
            .chain(
                self.agents
                    .host()
                    .read(cx)
                    .file_documents
                    .keys()
                    .map(|(id, _)| id),
            )
            .cloned()
            .collect();
        for workspace in workspace_ids {
            if let Some(browser) = self.host_file_browser(&workspace, cx) {
                let paths = browser.update(cx, |store, cx| {
                    let paths = store.authoritative().invalidated(None);
                    cx.notify();
                    paths
                });
                for path in paths {
                    self.request_stale_tree(workspace.clone(), path, cx);
                }
            }
            let documents: Vec<_> = self
                .agents
                .host()
                .read(cx)
                .file_documents
                .iter()
                .filter(|((id, _), _)| id == &workspace)
                .map(|((_, path), store)| {
                    (
                        path.clone(),
                        store.clone(),
                        store.read(cx).snapshot().visible,
                    )
                })
                .collect();
            for (path, store, visible) in documents {
                store.update(cx, |store, cx| {
                    store.authoritative().invalidated();
                    cx.notify();
                });
                if visible {
                    self.request_stale_read(workspace.clone(), path, cx);
                }
            }
        }
    }

    fn refresh_stale_files(&mut self, cx: &mut Context<Self>) {
        let trees: Vec<_> = self
            .agents
            .host()
            .read(cx)
            .file_browsers
            .iter()
            .flat_map(|(id, store)| {
                store
                    .read(cx)
                    .snapshot()
                    .directories
                    .iter()
                    .filter(|(_, d)| d.stale && d.visible)
                    .map(|(p, _)| (id.clone(), p.clone()))
                    .collect::<Vec<_>>()
            })
            .collect();
        for (id, path) in trees {
            self.request_stale_tree(id, path, cx);
        }
        let docs: Vec<_> = self
            .agents
            .host()
            .read(cx)
            .file_documents
            .iter()
            .filter(|(_, store)| {
                let snapshot = store.read(cx).snapshot();
                snapshot.visible
                    && (snapshot.stale
                        || (snapshot.payload.is_none()
                            && matches!(snapshot.state, LoadState::Loading)))
            })
            .map(|((id, path), _)| (id.clone(), path.clone()))
            .collect();
        for (id, path) in docs {
            self.request_stale_read(id, path, cx);
        }
    }
    fn request_stale_tree(
        &mut self,
        workspace: String,
        path: RelativeDirectoryPath,
        cx: &mut Context<Self>,
    ) {
        let generation = self.host_file_browser(&workspace, cx).and_then(|store| {
            store
                .read(cx)
                .snapshot()
                .directories
                .get(&path)
                .map(|row| row.generation)
        });
        let Some(generation) = generation else {
            return;
        };
        if self.file_provenance.values().any(|request| matches!(request,
            FileRequestProvenance::Tree { workspace: value, path: request_path, cursor: None, generation: value_generation }
                if value == &workspace && request_path == &path && *value_generation == generation
        )) { return; }
        if let Ok(query) = FileTreeQuery::new(path.clone(), None, Some(500))
            && let Ok(id) = self.files.tree(workspace.clone(), query)
        {
            self.file_provenance.insert(
                id,
                FileRequestProvenance::Tree {
                    workspace,
                    path,
                    cursor: None,
                    generation,
                },
            );
        }
    }
    fn request_stale_read(
        &mut self,
        workspace: String,
        path: RelativeFilePath,
        cx: &mut Context<Self>,
    ) {
        let generation = self
            .host_file_document(&workspace, &path, cx)
            .map(|store| store.read(cx).snapshot().generation);
        let Some(generation) = generation else {
            return;
        };
        if self.file_provenance.values().any(|request| matches!(request,
            FileRequestProvenance::Read { workspace: value, path: request_path, generation: value_generation }
                if value == &workspace && request_path == &path && *value_generation == generation
        )) { return; }
        if let Ok(id) = self.files.read(workspace.clone(), path.clone()) {
            self.file_provenance.insert(
                id,
                FileRequestProvenance::Read {
                    workspace,
                    path,
                    generation,
                },
            );
        }
    }

    fn host_file_browser(&self, id: &str, cx: &gpui::App) -> Option<Entity<FileBrowserStore>> {
        self.agents.host().read(cx).file_browsers.get(id).cloned()
    }
    fn host_file_document(
        &self,
        id: &str,
        path: &RelativeFilePath,
        cx: &gpui::App,
    ) -> Option<Entity<FileDocumentStore>> {
        self.agents
            .host()
            .read(cx)
            .file_documents
            .get(&(id.to_owned(), path.clone()))
            .cloned()
    }
    fn file_browser_fail_search(
        &self,
        id: &str,
        query: &str,
        message: String,
        cx: &mut Context<Self>,
    ) {
        if let Some(store) = self.host_file_browser(id, cx) {
            store.update(cx, |store, cx| {
                store.authoritative().search_fail(query, Arc::from(message));
                cx.notify();
            });
        }
    }
    fn file_browser_fail_directory(
        &self,
        id: &str,
        path: &RelativeDirectoryPath,
        generation: u64,
        message: String,
        cx: &mut Context<Self>,
    ) {
        if let Some(store) = self.host_file_browser(id, cx) {
            store.update(cx, |store, cx| {
                store
                    .authoritative()
                    .directory_fail(path, generation, Arc::from(message));
                cx.notify();
            });
        }
    }
    fn file_document_load_fail(
        &self,
        id: &str,
        path: &RelativeFilePath,
        generation: u64,
        message: String,
        cx: &mut Context<Self>,
    ) {
        if let Some(store) = self.host_file_document(id, path, cx) {
            store.update(cx, |store, cx| {
                store
                    .authoritative()
                    .load_fail(generation, Arc::from(message));
                cx.notify();
            });
        }
    }
    fn file_document_save_fail(
        &self,
        id: &str,
        path: &RelativeFilePath,
        revision: u64,
        message: String,
        cx: &mut Context<Self>,
    ) {
        if let Some(store) = self.host_file_document(id, path, cx) {
            store.update(cx, |store, cx| {
                store
                    .authoritative()
                    .save_failed(revision, Arc::from(message));
                cx.notify();
            });
        }
    }

    fn file_document_save_conflict(
        &self,
        id: &str,
        path: &RelativeFilePath,
        revision: u64,
        message: String,
        cx: &mut Context<Self>,
    ) {
        if let Some(store) = self.host_file_document(id, path, cx) {
            store.update(cx, |store, cx| {
                store
                    .authoritative()
                    .save_conflicted(revision, Arc::from(message));
                cx.notify();
            });
        }
    }

    fn file_document_revision_fail(
        &self,
        id: &str,
        path: &RelativeFilePath,
        revision: &str,
        message: String,
        cx: &mut Context<Self>,
    ) {
        if let Some(store) = self.host_file_document(id, path, cx) {
            store.update(cx, |store, cx| {
                store
                    .authoritative()
                    .revision_fail(revision, Arc::from(message));
                cx.notify();
            });
        }
    }

    fn file_cache_retention_changed(
        &mut self,
        workspace: String,
        path: RelativeFilePath,
        retained: bool,
        cx: &mut Context<Self>,
    ) {
        // Retention pins only the authoritative current payload. Historical Git
        // revisions remain in the bounded ready-payload LRU after projection.
        self.file_cache_order.retain(|key| match key {
            FileCacheKey::Current(id, item) => id != &workspace || item != &path,
            FileCacheKey::Revision(_, _, _) => true,
        });
        if retained {
            return;
        }
        let Some(store) = self.host_file_document(&workspace, &path, cx) else {
            return;
        };
        let snapshot = store.read(cx).snapshot().clone();
        if snapshot.payload.is_some() {
            self.file_cache_touch(FileCacheKey::Current(workspace.clone(), path.clone()), cx);
        }
        for (revision, row) in &snapshot.revisions {
            if row.payload.is_some() {
                self.file_cache_touch(
                    FileCacheKey::Revision(workspace.clone(), path.clone(), revision.clone()),
                    cx,
                );
            }
        }
    }

    fn file_cache_touch(&mut self, key: FileCacheKey, cx: &mut Context<Self>) {
        let (workspace, path) = match &key {
            FileCacheKey::Current(workspace, path) | FileCacheKey::Revision(workspace, path, _) => {
                (workspace, path)
            }
        };
        if matches!(key, FileCacheKey::Current(_, _))
            && self
                .host_file_document(workspace, path, cx)
                .is_some_and(|store| store.read(cx).snapshot().retained)
        {
            self.file_cache_order.retain(|value| value != &key);
            return;
        }
        self.file_cache_order.retain(|value| value != &key);
        let payload_len = self
            .host_file_document(workspace, path, cx)
            .map_or(0, |store| {
                let snapshot = store.read(cx).snapshot();
                match &key {
                    FileCacheKey::Current(_, _) => snapshot
                        .payload
                        .as_ref()
                        .map_or(0, DocumentPayload::byte_len),
                    FileCacheKey::Revision(_, _, revision) => snapshot
                        .revisions
                        .get(revision)
                        .and_then(|row| row.payload.as_ref())
                        .map_or(0, DocumentPayload::byte_len),
                }
            });
        if payload_len > 16 * 1024 * 1024 {
            if let Some(store) = self.host_file_document(workspace, path, cx) {
                store.update(cx, |store, cx| {
                    match &key {
                        FileCacheKey::Current(_, _) => store.authoritative().payload_evict(),
                        FileCacheKey::Revision(_, _, revision) => {
                            store.authoritative().revision_evict(revision)
                        }
                    }
                    cx.notify();
                });
            }
            return;
        }
        self.file_cache_order.push_back(key);
        loop {
            let total: usize = self
                .agents
                .host()
                .read(cx)
                .file_documents
                .values()
                .map(|store| {
                    let snapshot = store.read(cx).snapshot();
                    let current = if snapshot.retained {
                        0
                    } else {
                        snapshot
                            .payload
                            .as_ref()
                            .map_or(0, DocumentPayload::byte_len)
                    };
                    current
                        + snapshot
                            .revisions
                            .values()
                            .filter_map(|row| row.payload.as_ref())
                            .map(DocumentPayload::byte_len)
                            .sum::<usize>()
                })
                .sum();
            if self.file_cache_order.len() <= 48 && total <= 16 * 1024 * 1024 {
                break;
            }
            let Some(old) = self.file_cache_order.pop_front() else {
                break;
            };
            match old {
                FileCacheKey::Current(workspace, path) => {
                    if let Some(store) = self.host_file_document(&workspace, &path, cx) {
                        if store.read(cx).snapshot().retained {
                            continue;
                        }
                        store.update(cx, |store, cx| {
                            store.authoritative().payload_evict();
                            cx.notify();
                        });
                    }
                }
                FileCacheKey::Revision(workspace, path, revision) => {
                    if let Some(store) = self.host_file_document(&workspace, &path, cx) {
                        store.update(cx, |store, cx| {
                            store.authoritative().revision_evict(&revision);
                            cx.notify();
                        });
                    }
                }
            }
        }
    }

    fn file_availability(&self, cx: &gpui::App) -> FileAvailability {
        match self.agents.host().read(cx).availability() {
            AgentAvailability::Online => FileAvailability::Online,
            AgentAvailability::Connecting | AgentAvailability::Reconnecting { .. } => {
                FileAvailability::Reconnecting
            }
            AgentAvailability::Draining { .. } => FileAvailability::Draining,
            AgentAvailability::Offline { .. } | AgentAvailability::Error { .. } => {
                FileAvailability::Offline
            }
        }
    }
    fn file_availability_reconcile(&mut self, cx: &mut Context<Self>) {
        let availability = self.file_availability(cx);
        let browsers: Vec<_> = self
            .agents
            .host()
            .read(cx)
            .file_browsers
            .values()
            .cloned()
            .collect();
        let documents: Vec<_> = self
            .agents
            .host()
            .read(cx)
            .file_documents
            .values()
            .cloned()
            .collect();
        for store in browsers {
            let value = availability.clone();
            store.update(cx, |store, cx| {
                store.authoritative().availability_replace(value);
                cx.notify();
            });
        }
        for store in documents {
            let value = availability.clone();
            store.update(cx, |store, cx| {
                store.authoritative().availability_replace(value);
                cx.notify();
            });
        }
        if availability == FileAvailability::Online {
            self.refresh_stale_files(cx);
        }
    }

    fn mutation_matches_phase(&self, kind: OnboardingMutationKind) -> bool {
        matches!(
            (kind, &self.initial_phase),
            (
                OnboardingMutationKind::Profile,
                InitialPhase::ProfileRequired
            ) | (
                OnboardingMutationKind::Providers,
                InitialPhase::ProvidersMissing
            ) | (OnboardingMutationKind::Project, InitialPhase::FirstProject)
                | (
                    OnboardingMutationKind::Complete,
                    InitialPhase::CompletionRequired
                )
        )
    }

    fn accept_snapshot(
        &mut self,
        snapshot: DesktopBootstrap,
        git: Option<BTreeMap<String, GitState>>,
        daemon_version: Option<String>,
        cx: &mut Context<Self>,
    ) {
        self.setup_owed = Some(!snapshot.onboarding.completed);
        if !self.mounted && !snapshot.onboarding.completed {
            self.initial_phase = if !snapshot.onboarding.steps.profile.done {
                InitialPhase::ProfileRequired
            } else if !snapshot.onboarding.steps.providers.done
                || self.providers_continue_required
                || self.mutation_pending(OnboardingMutationKind::Providers)
            {
                InitialPhase::ProvidersMissing
            } else if !snapshot.onboarding.steps.project.done {
                InitialPhase::FirstProject
            } else {
                InitialPhase::CompletionRequired
            };
        } else {
            self.mounted = true;
        }
        self.profile_version = Some(snapshot.profile.version.clone());
        self.profile_name = snapshot.profile.name.clone();
        self.profile_email = snapshot.profile.email.clone();
        let host_entity = self.agents.host().clone();
        let (catalog, retained_git) = {
            let host = host_entity.read(cx);
            (host.catalog.clone(), host.git.clone())
        };
        let next_git = git.map(Arc::new).unwrap_or(retained_git);
        self.chat.catalog = super::chat_state::model_catalog(&snapshot.config);
        let chat_catalog = self.chat.catalog.clone();
        let catalog_snapshot = catalog.update(cx, |catalog, cx| {
            let reconciled = catalog.reconcile(&snapshot, next_git.as_ref());
            cx.notify();
            reconciled
        });
        host_entity.update(cx, |host, cx| {
            if let Some(version) = daemon_version {
                host.daemon_version = Some(version);
            }
            host.git = next_git;
            host.snapshot = Some(Arc::new(snapshot));
            for store in host.workspaces.values() {
                store.update(cx, |store, cx| {
                    store.catalog_reconcile(&catalog_snapshot);
                    cx.notify();
                });
            }
            for store in host.chats.values() {
                let chat_catalog = chat_catalog.clone();
                store.update(cx, |store, cx| {
                    store.catalog_reconcile(chat_catalog);
                    cx.notify();
                });
            }
            cx.notify();
        });
    }
}

impl ConnectivityController {
    pub fn chat_protocol_limitations(&self) -> super::ChatProtocolLimitations {
        super::ChatProtocolLimitations::V23
    }

    pub fn workspace_persistence_error(&self) -> Option<&str> {
        self.workspace_persistence_error.as_deref()
    }

    pub fn workspace(&self, key: &WorkspaceKey, cx: &gpui::App) -> Option<Entity<WorkspaceStore>> {
        self.agents.host().read(cx).workspace(key).cloned()
    }

    pub fn chat(&self, key: &ConversationKey, cx: &gpui::App) -> Option<Entity<ChatStore>> {
        self.agents.host().read(cx).chat(key).cloned()
    }

    pub fn focused_chat(&self) -> Option<&ConversationKey> {
        self.chat.focused.as_ref()
    }

    pub fn created_chat_navigation_take(&mut self) -> Option<super::CreatedChatNavigation> {
        self.chat.created_navigation.pop_front()
    }

    pub fn workspace_materialize(
        &mut self,
        key: WorkspaceKey,
        cx: &mut Context<Self>,
    ) -> Option<Entity<WorkspaceStore>> {
        let host = self.agents.host().clone();
        let namespace = host.read(cx).namespace.clone();
        if key.namespace() != &namespace {
            return None;
        }
        if let Some(store) = host.read(cx).workspace(&key).cloned() {
            return Some(store);
        }
        let tx = self.chat.output_tx.clone();
        let store_key = key.clone();
        let store_namespace = namespace.clone();
        let persistence = self.workspace_persistence.clone();
        let store = cx.new(move |_| {
            let output = move |output| {
                let _ = tx.send_blocking(super::chat_state::StoreOutput::Workspace(output));
            };
            if let Some(persistence) = persistence {
                WorkspaceStore::restore(store_namespace, store_key, persistence, output)
            } else {
                WorkspaceStore::with_listener(store_namespace, store_key, output)
            }
        });
        let catalog = host.read(cx).catalog.read(cx).snapshot().clone();
        store.update(cx, |store, cx| {
            store.catalog_reconcile(&catalog);
            cx.notify();
        });
        host.update(cx, |host, _| {
            host.workspaces.insert(key, store.clone());
        });
        Some(store)
    }

    pub fn chat_materialize(
        &mut self,
        key: ConversationKey,
        cx: &mut Context<Self>,
    ) -> Option<Entity<ChatStore>> {
        let host = self.agents.host().clone();
        if key.namespace() != &host.read(cx).namespace {
            return None;
        }
        if let Some(store) = host.read(cx).chat(&key).cloned() {
            return Some(store);
        }
        let tx = self.chat.output_tx.clone();
        let catalog = Arc::clone(&self.chat.catalog);
        let store_key = key.clone();
        let store = cx.new(move |_| {
            ChatStore::with_listener(store_key, catalog, move |output| {
                let _ = tx.send_blocking(super::chat_state::StoreOutput::Chat(output));
            })
        });
        let availability = self.chat_availability(cx);
        store.update(cx, |store, cx| {
            store.authoritative().availability_reconcile(availability);
            cx.notify();
        });
        host.update(cx, |host, _| {
            host.chats.insert(key, store.clone());
        });
        Some(store)
    }

    pub fn chat_focus(&mut self, conversation: ConversationKey, cx: &mut Context<Self>) -> bool {
        let Some(store) = self.chat_materialize(conversation.clone(), cx) else {
            return false;
        };
        store.update(cx, |store, cx| {
            store.authoritative().load_started();
            cx.notify();
        });
        match self.chat.transport.focus(conversation.id().to_owned()) {
            Ok(request_id) => {
                self.chat.provenance.insert(
                    request_id,
                    super::chat_state::RequestProvenance::Focus {
                        conversation: conversation.clone(),
                    },
                );
                self.chat.focused = Some(conversation);
                true
            }
            Err(error) => {
                store.update(cx, |store, cx| {
                    store.authoritative().load_failed(error.message);
                    cx.notify();
                });
                false
            }
        }
    }

    pub fn chat_unfocus(&mut self) -> bool {
        match self.chat.transport.unfocus() {
            Ok(request_id) => {
                self.chat
                    .provenance
                    .insert(request_id, super::chat_state::RequestProvenance::Unfocus);
                self.chat.focused = None;
                true
            }
            Err(_) => false,
        }
    }

    fn existing_chat(&self, key: &ConversationKey, cx: &gpui::App) -> Option<Entity<ChatStore>> {
        self.agents.host().read(cx).chat(key).cloned()
    }

    fn existing_workspace(
        &self,
        key: &WorkspaceKey,
        cx: &gpui::App,
    ) -> Option<Entity<WorkspaceStore>> {
        self.agents.host().read(cx).workspace(key).cloned()
    }

    fn chat_availability_reconcile(&mut self, cx: &mut Context<Self>) {
        let availability = self.chat_availability(cx);
        let stores: Vec<_> = self
            .agents
            .host()
            .read(cx)
            .materialized_chats()
            .map(|(_, store)| store.clone())
            .collect();
        for store in stores {
            let availability = availability.clone();
            store.update(cx, |store, cx| {
                store.authoritative().availability_reconcile(availability);
                cx.notify();
            });
        }
        if matches!(availability, ChatAvailability::Online) {
            let conversations: Vec<_> = self.chat.draft_pending.keys().cloned().collect();
            for conversation in conversations {
                self.draft_save_flush(&conversation, None, cx);
            }
        }
    }

    fn refresh_focused(&mut self, cx: &mut Context<Self>) {
        self.refresh_focused_with(false, cx);
    }

    fn refresh_focused_hint(&mut self, cx: &mut Context<Self>) {
        self.refresh_focused_with(true, cx);
    }

    fn refresh_focused_with(&mut self, hinted: bool, cx: &mut Context<Self>) {
        let Some(conversation) = self.chat.focused.clone() else {
            return;
        };
        let Some(store) = self.existing_chat(&conversation, cx) else {
            return;
        };
        if hinted {
            // The transport retains one dirty focused conversation. A focus
            // change replaces an older pending hint, so retire both its local
            // provenance and the matching store operation before recording the
            // new focused request.
            let mut retired = Vec::new();
            for provenance in self.chat.provenance.values() {
                if let super::chat_state::RequestProvenance::Refresh {
                    conversation: pending,
                    ..
                } = provenance
                    && pending != &conversation
                    && !retired.contains(pending)
                {
                    retired.push(pending.clone());
                }
            }
            self.chat.provenance.retain(|_, provenance| {
                !matches!(
                    provenance,
                    super::chat_state::RequestProvenance::Refresh {
                        conversation: pending,
                        ..
                    } if pending != &conversation
                )
            });
            for retired_conversation in retired {
                if let Some(retired_store) = self.existing_chat(&retired_conversation, cx) {
                    retired_store.update(cx, |store, cx| {
                        store.authoritative().refresh_succeeded();
                        cx.notify();
                    });
                }
            }
        }
        let admission = if hinted {
            self.chat
                .transport
                .refresh_hint(conversation.id().to_owned())
        } else {
            self.chat.transport.refresh(conversation.id().to_owned())
        };
        match admission {
            Ok(request_id) => {
                self.chat.provenance.insert(
                    request_id,
                    super::chat_state::RequestProvenance::Refresh {
                        conversation,
                        initial: false,
                    },
                );
                let mutation = crate::chat::ChatMutationId::new(format!("refresh{}", request_id.0))
                    .expect("request identity is nonempty");
                store.update(cx, |store, cx| {
                    store.authoritative().refresh_started(mutation);
                    cx.notify();
                });
            }
            Err(error) => store.update(cx, |store, cx| {
                store.authoritative().refresh_failed(error.message);
                cx.notify();
            }),
        }
    }

    fn apply_chat_event(&mut self, event: super::ChatEvent, cx: &mut Context<Self>) {
        use super::ChatEvent::*;
        match event {
            Focused {
                request_id,
                agent_id,
                snapshot,
            }
            | Refreshed {
                request_id,
                agent_id,
                snapshot,
            } => {
                let Some(provenance) = self.chat.provenance.remove(&request_id) else {
                    return;
                };
                let (conversation, initial) = match provenance {
                    super::chat_state::RequestProvenance::Focus { conversation } => {
                        (conversation, true)
                    }
                    super::chat_state::RequestProvenance::Refresh {
                        conversation,
                        initial,
                    } => (conversation, initial),
                    _ => return,
                };
                if conversation.id() != agent_id {
                    return;
                }
                let Some(store) = self.existing_chat(&conversation, cx) else {
                    return;
                };
                let availability = self.chat_availability(cx);
                let had_pending_send = store.read(cx).snapshot().composer.pending_send.is_some();
                self.draft_timestamp_observe(&conversation, snapshot.bootstrap.draft.updated_at);
                store.update(cx, |store, cx| {
                    let mut writer = store.authoritative();
                    writer.bootstrap_reconcile(snapshot.bootstrap);
                    writer.history_latest_reconcile(
                        snapshot.history.cursor,
                        snapshot.history.has_more,
                        snapshot.history.runs,
                    );
                    writer.question_reconcile(snapshot.pending_question);
                    writer.availability_reconcile(availability);
                    if !initial {
                        writer.refresh_succeeded();
                    }
                    cx.notify();
                });
                let snapshot = store.read(cx).snapshot().clone();
                if had_pending_send
                    && snapshot.composer.pending_send.is_none()
                    && snapshot.composer.text.is_empty()
                {
                    self.draft_save_schedule(
                        conversation,
                        Arc::from(""),
                        snapshot.composer.revision,
                        true,
                        cx,
                    );
                }
            }
            Unfocused { request_id, .. } => {
                self.chat.provenance.remove(&request_id);
            }
            OlderLoaded {
                request_id,
                agent_id,
                page,
                ..
            } => {
                let Some(super::chat_state::RequestProvenance::Older { conversation }) =
                    self.chat.provenance.remove(&request_id)
                else {
                    return;
                };
                if conversation.id() != agent_id {
                    return;
                }
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().history_older_prepend(
                            page.cursor,
                            page.has_more,
                            page.runs,
                        );
                        cx.notify();
                    });
                }
            }
            AgentCreated {
                request_id,
                response,
            } => {
                let Some(super::chat_state::RequestProvenance::Create {
                    workspace,
                    agent_id,
                    ..
                }) = self.chat.provenance.remove(&request_id)
                else {
                    return;
                };
                if response.agent.workspace_id != workspace.id()
                    || response.agent.id != agent_id.as_ref()
                {
                    if let Some(store) = self.existing_workspace(&workspace, cx) {
                        store.update(cx, |store, cx| {
                            store.session_create_failed(
                                "Conversation creation returned an unexpected identity. Try again.",
                            );
                            cx.notify();
                        });
                    }
                    return;
                }
                if let Some(store) = self.existing_workspace(&workspace, cx) {
                    store.update(cx, |store, cx| {
                        store.session_create_succeeded();
                        cx.notify();
                    });
                }
                self.chat
                    .created_navigation
                    .push_back(super::CreatedChatNavigation {
                        workspace,
                        conversation: ConversationKey::new(
                            self.agents.host().read(cx).namespace.clone(),
                            response.agent.id,
                        ),
                    });
            }
            AgentArchived {
                request_id,
                agent_id,
                response,
            }
            | AgentUnarchived {
                request_id,
                agent_id,
                response,
            } => {
                let Some(provenance) = self.chat.provenance.remove(&request_id) else {
                    return;
                };
                let (workspace, conversation) = match provenance {
                    super::chat_state::RequestProvenance::Archive {
                        workspace,
                        conversation,
                        ..
                    }
                    | super::chat_state::RequestProvenance::Restore {
                        workspace,
                        conversation,
                        ..
                    } => (workspace, conversation),
                    _ => return,
                };
                if conversation.id() != agent_id || response.agent.id != agent_id {
                    return;
                }
                if let Some(store) = self.existing_workspace(&workspace, cx) {
                    store.update(cx, |store, cx| {
                        store.conversation_archive_succeeded(&conversation);
                        cx.notify();
                    });
                }
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().agent_reconcile(response.agent);
                        cx.notify();
                    });
                }
            }
            AgentMarkedRead {
                request_id,
                agent_id,
                response,
            } => {
                let Some(super::chat_state::RequestProvenance::MarkRead { conversation, .. }) =
                    self.chat.provenance.remove(&request_id)
                else {
                    return;
                };
                if conversation.id() != agent_id {
                    return;
                }
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        let mut writer = store.authoritative();
                        writer.agent_reconcile(response.agent);
                        writer.mark_read_succeeded();
                        cx.notify();
                    });
                }
            }
            DraftSaved {
                request_id,
                agent_id,
                response,
            } => {
                let Some(provenance) = self.chat.provenance.remove(&request_id) else {
                    return;
                };
                let (conversation, draft_revision) = match &provenance {
                    super::chat_state::RequestProvenance::Draft {
                        conversation,
                        revision,
                    } => (conversation.clone(), Some(*revision)),
                    super::chat_state::RequestProvenance::Mode { conversation, .. } => {
                        (conversation.clone(), None)
                    }
                    _ => return,
                };
                if conversation.id() != agent_id {
                    return;
                }
                if let Some(revision) = draft_revision
                    && self
                        .chat
                        .draft_pending
                        .get(&conversation)
                        .is_some_and(|pending| pending.revision == revision)
                {
                    self.chat.draft_pending.remove(&conversation);
                }
                self.draft_timestamp_observe(&conversation, response.draft.updated_at);
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        let mut writer = store.authoritative();
                        match provenance {
                            super::chat_state::RequestProvenance::Draft { revision, .. } => {
                                writer.draft_save_succeeded(revision, response.draft)
                            }
                            super::chat_state::RequestProvenance::Mode {
                                mutation,
                                mode,
                                revision,
                                ..
                            } => {
                                writer.mode_save_succeeded(
                                    &mutation,
                                    revision,
                                    response.draft,
                                    mode,
                                );
                            }
                            _ => {}
                        }
                        cx.notify();
                    });
                }
            }
            MessageSent {
                request_id,
                agent_id,
                response,
            } => {
                let Some(super::chat_state::RequestProvenance::Send {
                    conversation,
                    message_id,
                    ..
                }) = self.chat.provenance.remove(&request_id)
                else {
                    return;
                };
                if conversation.id() != agent_id || response.message.id != message_id {
                    return;
                }
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store
                            .authoritative()
                            .message_send_succeeded(response.message);
                        cx.notify();
                    });
                    let snapshot = store.read(cx).snapshot().clone();
                    if snapshot.composer.text.is_empty() {
                        self.draft_save_schedule(
                            conversation,
                            Arc::from(""),
                            snapshot.composer.revision,
                            true,
                            cx,
                        );
                    }
                }
            }
            AgentAborted {
                request_id,
                agent_id,
                response,
            } => {
                let Some(super::chat_state::RequestProvenance::Abort { conversation, .. }) =
                    self.chat.provenance.remove(&request_id)
                else {
                    return;
                };
                if conversation.id() != agent_id {
                    return;
                }
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        let mut writer = store.authoritative();
                        writer.agent_reconcile(response.agent);
                        writer.slash_commands_reconcile(response.slash_commands);
                        writer.abort_succeeded();
                        cx.notify();
                    });
                }
            }
            QuestionAnswered {
                request_id,
                agent_id,
                response,
            } => {
                let Some(super::chat_state::RequestProvenance::Question { conversation, .. }) =
                    self.chat.provenance.remove(&request_id)
                else {
                    return;
                };
                if conversation.id() != agent_id {
                    return;
                };
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store
                            .authoritative()
                            .question_submit_succeeded(response.question);
                        cx.notify();
                    });
                }
            }
            SlashCommandInvoked {
                request_id,
                agent_id,
                response,
            } => {
                let Some(super::chat_state::RequestProvenance::Command { conversation, .. }) =
                    self.chat.provenance.remove(&request_id)
                else {
                    return;
                };
                if conversation.id() != agent_id {
                    return;
                };
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        let mut writer = store.authoritative();
                        writer.agent_reconcile(response.agent);
                        writer.slash_commands_reconcile(response.slash_commands);
                        writer.command_succeeded();
                        cx.notify();
                    });
                }
            }
            ProcessStopped {
                request_id,
                agent_id,
                ..
            } => {
                let Some(super::chat_state::RequestProvenance::StopProcess {
                    conversation,
                    process_id,
                    ..
                }) = self.chat.provenance.remove(&request_id)
                else {
                    return;
                };
                if conversation.id() != agent_id {
                    return;
                };
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store
                            .authoritative()
                            .process_operation_succeeded(&process_id);
                        cx.notify();
                    });
                }
                if self.chat.focused.as_ref() == Some(&conversation) {
                    self.refresh_focused(cx);
                }
            }
            RequestsRetired { request_ids } => {
                for request_id in request_ids {
                    self.chat.provenance.remove(&request_id);
                }
            }
            Failed {
                request_id,
                operation: _,
                error,
                ..
            } => {
                let Some(provenance) = self.chat.provenance.remove(&request_id) else {
                    return;
                };
                // Transport already redacts secrets. Preserve its typed,
                // displayable message instead of replacing useful server detail.
                self.apply_chat_failure(provenance, Arc::from(error.message), cx);
            }
            AgentReordered { request_id, .. } | AgentCompacted { request_id, .. } => {
                self.chat.provenance.remove(&request_id);
            }
            Stopped => {}
        }
        cx.notify();
    }

    fn apply_chat_failure(
        &mut self,
        provenance: super::chat_state::RequestProvenance,
        message: Arc<str>,
        cx: &mut Context<Self>,
    ) {
        use super::chat_state::RequestProvenance::*;
        match provenance {
            Create { workspace, .. } => {
                if let Some(store) = self.existing_workspace(&workspace, cx) {
                    store.update(cx, |store, cx| {
                        store.session_create_failed(message);
                        cx.notify();
                    });
                }
            }
            Archive {
                workspace,
                conversation,
                ..
            }
            | Restore {
                workspace,
                conversation,
                ..
            } => {
                if let Some(store) = self.existing_workspace(&workspace, cx) {
                    store.update(cx, |store, cx| {
                        store.conversation_archive_failed(&conversation, message);
                        cx.notify();
                    });
                }
            }
            Focus { conversation } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().load_failed(message);
                        cx.notify();
                    });
                }
            }
            Refresh { conversation, .. } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().refresh_failed(message);
                        cx.notify();
                    });
                }
            }
            Older { conversation } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().history_older_failed(message);
                        cx.notify();
                    });
                }
            }
            Draft {
                conversation,
                revision,
            } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().draft_save_failed(revision, message);
                        cx.notify();
                    });
                }
            }
            Mode {
                conversation,
                mutation,
                ..
            } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().mode_save_failed(&mutation, message);
                        cx.notify();
                    });
                }
            }
            Send { conversation, .. } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().message_send_failed(message);
                        cx.notify();
                    });
                }
            }
            Abort { conversation, .. } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().abort_failed(message);
                        cx.notify();
                    });
                }
            }
            Question { conversation, .. } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().question_submit_failed(message);
                        cx.notify();
                    });
                }
            }
            Command { conversation, .. } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().command_failed(message);
                        cx.notify();
                    });
                }
            }
            StopProcess {
                conversation,
                process_id,
                ..
            } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store
                            .authoritative()
                            .process_operation_failed(process_id, message);
                        cx.notify();
                    });
                }
            }
            MarkRead { conversation, .. } => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().mark_read_failed(message);
                        cx.notify();
                    });
                }
            }
            Unfocus => {}
        }
    }

    fn apply_chat_hint(
        &mut self,
        event: HappyAgentEventType,
        payload: Option<EventHintPayload>,
        cx: &mut Context<Self>,
    ) {
        use super::HappyAgentEventType::*;
        let Some(focused) = self.chat.focused.clone() else {
            return;
        };
        let Some(store) = self.existing_chat(&focused, cx) else {
            return;
        };
        let Some(payload) = payload else {
            self.refresh_focused_hint(cx);
            return;
        };
        let direct = super::chat_state::hinted_agent(event, &payload);
        let matches = direct == Some(focused.id())
            || match event {
                ProcessStarted | ProcessUpdated | ProcessExited if direct.is_none() => {
                    let id = payload
                        .process_id
                        .as_deref()
                        .or_else(|| payload.process.as_ref().and_then(|v| v.id.as_deref()));
                    id.is_some_and(|id| {
                        store
                            .read(cx)
                            .snapshot()
                            .processes
                            .iter()
                            .any(|process| process.id == id)
                    })
                }
                QuestionCreated | QuestionUpdated if direct.is_none() => {
                    let id = payload
                        .question_id
                        .as_deref()
                        .or_else(|| payload.question.as_ref().and_then(|v| v.id.as_deref()));
                    id.is_some_and(|id| {
                        store
                            .read(cx)
                            .snapshot()
                            .question
                            .as_ref()
                            .is_some_and(|question| question.id == id)
                    })
                }
                _ => false,
            };
        if matches {
            self.refresh_focused_hint(cx);
        }
    }

    fn draft_save_schedule(
        &mut self,
        conversation: ConversationKey,
        text: Arc<str>,
        revision: u64,
        immediate: bool,
        cx: &mut Context<Self>,
    ) {
        self.chat.draft_generation = self.chat.draft_generation.wrapping_add(1);
        let generation = self.chat.draft_generation;
        let updated_at = self.draft_timestamp_next(&conversation);
        let mutation = crate::chat::ChatMutationId::new(cuid2::create_id())
            .expect("CUID2 draft mutation is nonempty");
        self.chat.draft_pending.insert(
            conversation.clone(),
            super::chat_state::PendingDraft {
                mutation,
                text,
                revision,
                generation,
                updated_at,
            },
        );
        if immediate {
            self.draft_save_flush(&conversation, Some(generation), cx);
            return;
        }
        cx.spawn(async move |this, cx| {
            gpui::Timer::after(std::time::Duration::from_millis(300)).await;
            let _ = this.update(cx, |controller, cx| {
                controller.draft_save_flush(&conversation, Some(generation), cx);
            });
        })
        .detach();
    }

    fn draft_save_flush(
        &mut self,
        conversation: &ConversationKey,
        expected_generation: Option<u64>,
        cx: &mut Context<Self>,
    ) {
        let Some(pending) = self.chat.draft_pending.get(conversation).cloned() else {
            return;
        };
        if expected_generation.is_some_and(|generation| generation != pending.generation)
            || !self.live_mutations
            || self.chat.provenance.values().any(|provenance| {
                matches!(
                    provenance,
                    super::chat_state::RequestProvenance::Draft {
                        conversation: active,
                        revision,
                    } if active == conversation && *revision == pending.revision
                )
            })
        {
            return;
        }
        let Some(store) = self.existing_chat(conversation, cx) else {
            return;
        };
        let snapshot = store.read(cx).snapshot().clone();
        let Some(mode) = snapshot
            .composer
            .mode
            .clone()
            .or_else(|| snapshot.mode.clone())
        else {
            store.update(cx, |store, cx| {
                store.authoritative().draft_save_failed(
                    pending.revision,
                    "Select a model before saving this draft.",
                );
                cx.notify();
            });
            return;
        };
        let mutation = pending.mutation.clone();
        let request = super::chat_protocol::SaveAgentDraftRequest {
            draft: Some(super::chat_protocol::AgentDraftRequest {
                text: pending.text.to_string(),
                provider_id: mode.provider_id,
                model_id: mode.model_id,
                effort: mode.effort,
                service_tier: mode.service_tier,
                permission_mode: mode.permission_mode,
            }),
            updated_at: Some(pending.updated_at),
            mutation_id: Some(mutation.as_str().to_owned()),
        };
        match self
            .chat
            .transport
            .save_draft(conversation.id().to_owned(), request)
        {
            Ok(request_id) => {
                self.chat.provenance.insert(
                    request_id,
                    super::chat_state::RequestProvenance::Draft {
                        conversation: conversation.clone(),
                        revision: pending.revision,
                    },
                );
                store.update(cx, |store, cx| {
                    store
                        .authoritative()
                        .draft_save_started(mutation, pending.revision);
                    cx.notify();
                });
            }
            Err(error) => store.update(cx, |store, cx| {
                store
                    .authoritative()
                    .draft_save_failed(pending.revision, error.message);
                cx.notify();
            }),
        }
    }

    fn apply_store_output(
        &mut self,
        output: super::chat_state::StoreOutput,
        cx: &mut Context<Self>,
    ) {
        use super::chat_protocol::*;
        use crate::chat::{ChatOutput::*, WorkspaceOutput::*};
        match output {
            super::chat_state::StoreOutput::Workspace(PersistenceRequested { snapshot }) => {
                let workspace = snapshot.workspace.clone();
                if let Some(persistence) = &self.workspace_persistence
                    && let Err(error) = persistence.write_async(snapshot)
                {
                    self.workspace_persistence_error = Some(Arc::from(error.to_string()));
                    self.workspace_persistence_error_workspace = Some(workspace);
                }
            }
            super::chat_state::StoreOutput::Workspace(SessionCreateRequested {
                workspace,
                id,
                mutation,
            }) => {
                let request = CreateAgentRequest {
                    workspace_id: workspace.id().to_owned(),
                    parent_agent_id: None,
                    title: None,
                    id: Some(id.as_str().to_owned()),
                    mutation_id: Some(mutation.as_str().to_owned()),
                };
                match self.chat.transport.create_agent(request) {
                    Ok(admission) => {
                        self.chat.provenance.insert(
                            admission.request_id,
                            super::chat_state::RequestProvenance::Create {
                                workspace,
                                mutation,
                                agent_id: Arc::from(admission.agent_id),
                            },
                        );
                    }
                    Err(error) => {
                        if let Some(store) = self.existing_workspace(&workspace, cx) {
                            store.update(cx, |store, cx| {
                                store.session_create_failed(error.message);
                                cx.notify();
                            });
                        }
                    }
                }
            }
            super::chat_state::StoreOutput::Workspace(SessionArchiveRequested {
                conversation,
                mutation,
            }) => {
                self.admit_archive(conversation, mutation, false, cx);
            }
            super::chat_state::StoreOutput::Workspace(SessionRestoreRequested {
                conversation,
                mutation,
            }) => {
                self.admit_archive(conversation, mutation, true, cx);
            }
            super::chat_state::StoreOutput::Chat(DraftUpdated {
                conversation,
                text,
                revision,
            }) => {
                let immediate = text.is_empty();
                self.draft_save_schedule(conversation, text, revision, immediate, cx);
            }
            super::chat_state::StoreOutput::Chat(ModeSaveRequested {
                conversation,
                mode,
                mutation,
            }) => {
                self.draft_save_flush(&conversation, None, cx);
                let Some(store) = self.existing_chat(&conversation, cx) else {
                    return;
                };
                let snapshot = store.read(cx).snapshot().clone();
                let text = snapshot.composer.text.to_string();
                let mode = snapshot
                    .composer
                    .mode
                    .clone()
                    .or_else(|| snapshot.mode.clone())
                    .unwrap_or(mode);
                let updated_at = self.draft_timestamp_next(&conversation);
                let request = SaveAgentDraftRequest {
                    draft: Some(AgentDraftRequest {
                        text,
                        provider_id: mode.provider_id.clone(),
                        model_id: mode.model_id.clone(),
                        effort: mode.effort.clone(),
                        service_tier: mode.service_tier.clone(),
                        permission_mode: mode.permission_mode,
                    }),
                    updated_at: Some(updated_at),
                    mutation_id: Some(mutation.as_str().to_owned()),
                };
                match self
                    .chat
                    .transport
                    .save_draft(conversation.id().to_owned(), request)
                {
                    Ok(id) => {
                        self.chat.provenance.insert(
                            id,
                            super::chat_state::RequestProvenance::Mode {
                                conversation,
                                mutation,
                                mode,
                                revision: snapshot.composer.revision,
                            },
                        );
                    }
                    Err(error) => store.update(cx, |store, cx| {
                        store
                            .authoritative()
                            .mode_save_failed(&mutation, error.message);
                        cx.notify();
                    }),
                }
            }
            super::chat_state::StoreOutput::Chat(MessageSendRequested {
                conversation,
                id,
                text,
                images,
                mode,
                delivery,
                mutation,
            }) => {
                let request_text = if text.trim().is_empty() {
                    images
                        .iter()
                        .map(|image| format!("[image:{}]", image.mime_type))
                        .collect::<String>()
                } else {
                    text.to_string()
                };
                let content = (!images.is_empty()).then(|| {
                    images
                        .into_iter()
                        .map(|image| SendMessageBlock::Image {
                            mime_type: image.mime_type.to_string(),
                            data: image.data.to_string(),
                        })
                        .collect()
                });
                let request = SendMessageRequest {
                    id: Some(id.as_str().to_owned()),
                    text: request_text,
                    client_metadata: None,
                    content,
                    delivery: Some(delivery),
                    mode,
                };
                match self
                    .chat
                    .transport
                    .send_message(conversation.id().to_owned(), request)
                {
                    Ok(admission) => {
                        self.chat.provenance.insert(
                            admission.request_id,
                            super::chat_state::RequestProvenance::Send {
                                conversation,
                                mutation,
                                message_id: admission.message_id,
                            },
                        );
                    }
                    Err(error) => {
                        if let Some(store) = self.existing_chat(&conversation, cx) {
                            store.update(cx, |store, cx| {
                                store.authoritative().message_send_failed(error.message);
                                cx.notify();
                            });
                        }
                    }
                }
            }
            super::chat_state::StoreOutput::Chat(AbortRequested {
                conversation,
                expected_run_id,
                mutation,
            }) => {
                let request = AbortAgentRequest {
                    expected_run_id: expected_run_id.map(|v| v.to_string()),
                    mutation_id: Some(mutation.as_str().to_owned()),
                };
                self.admit_chat_mutation(
                    conversation,
                    mutation,
                    cx,
                    |transport, agent| transport.abort_agent(agent, request),
                    |conversation, mutation| super::chat_state::RequestProvenance::Abort {
                        conversation,
                        mutation,
                    },
                    |writer, message| writer.abort_failed(message),
                );
            }
            super::chat_state::StoreOutput::Chat(HistoryOlderRequested {
                conversation,
                before,
            }) => {
                let Some(before) = before else {
                    if let Some(store) = self.existing_chat(&conversation, cx) {
                        store.update(cx, |store, cx| {
                            store
                                .authoritative()
                                .history_older_failed("No older history cursor is available.");
                            cx.notify();
                        });
                    }
                    return;
                };
                match self
                    .chat
                    .transport
                    .load_older(conversation.id().to_owned(), before.to_string())
                {
                    Ok(id) => {
                        self.chat.provenance.insert(
                            id,
                            super::chat_state::RequestProvenance::Older { conversation },
                        );
                    }
                    Err(error) => {
                        if let Some(store) = self.existing_chat(&conversation, cx) {
                            store.update(cx, |store, cx| {
                                store.authoritative().history_older_failed(error.message);
                                cx.notify();
                            });
                        }
                    }
                }
            }
            super::chat_state::StoreOutput::Chat(MessageRetryRequested {
                conversation,
                message_id,
                ..
            }) => {
                // Protocol 23 has no retry route. Keep this limitation visible in typed state.
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        store.authoritative().retry_failed(
                            message_id,
                            "Message retry is not supported by Happy Agent protocol 23.",
                        );
                        cx.notify();
                    });
                }
            }
            super::chat_state::StoreOutput::Chat(MarkReadRequested {
                conversation,
                mutation,
            }) => {
                let request = MarkAgentReadRequest {
                    mutation_id: Some(mutation.as_str().to_owned()),
                };
                self.admit_chat_mutation(
                    conversation,
                    mutation,
                    cx,
                    |transport, agent| transport.mark_agent_read(agent, request),
                    |conversation, mutation| super::chat_state::RequestProvenance::MarkRead {
                        conversation,
                        mutation,
                    },
                    |writer, message| writer.mark_read_failed(message),
                );
            }
            super::chat_state::StoreOutput::Chat(SlashCommandRequested {
                conversation,
                command,
                arguments,
                mode,
                mutation,
            }) => {
                let name = command.to_string();
                let request = InvokeSlashCommandRequest {
                    arguments: arguments.map(|v| v.to_string()),
                    mode,
                    mutation_id: Some(mutation.as_str().to_owned()),
                };
                self.admit_chat_mutation(
                    conversation,
                    mutation,
                    cx,
                    |transport, agent| transport.invoke_slash_command(agent, name, request),
                    |conversation, mutation| super::chat_state::RequestProvenance::Command {
                        conversation,
                        mutation,
                    },
                    |writer, message| writer.command_failed(message),
                );
            }
            super::chat_state::StoreOutput::Chat(QuestionSubmitRequested {
                conversation,
                question_id,
                answers,
                mutation,
            }) => {
                let request = AnswerQuestionRequest {
                    answers: answers
                        .into_iter()
                        .map(|(key, values)| {
                            (
                                key.to_string(),
                                values.into_iter().map(|v| v.to_string()).collect(),
                            )
                        })
                        .collect(),
                    mutation_id: Some(mutation.as_str().to_owned()),
                };
                let question_id = question_id.to_string();
                self.admit_chat_mutation(
                    conversation,
                    mutation,
                    cx,
                    |transport, agent| transport.answer_question(agent, question_id, request),
                    |conversation, mutation| super::chat_state::RequestProvenance::Question {
                        conversation,
                        mutation,
                    },
                    |writer, message| writer.question_submit_failed(message),
                );
            }
            super::chat_state::StoreOutput::Chat(ProcessStopRequested {
                conversation,
                process_id,
                mutation,
            }) => {
                let id_for_request = process_id.to_string();
                let id_for_provenance = Arc::clone(&process_id);
                self.admit_chat_mutation(
                    conversation,
                    mutation,
                    cx,
                    |transport, agent| transport.stop_process(agent, id_for_request),
                    |conversation, mutation| super::chat_state::RequestProvenance::StopProcess {
                        conversation,
                        mutation,
                        process_id: id_for_provenance,
                    },
                    |writer, message| writer.process_operation_failed(process_id, message),
                );
            }
            super::chat_state::StoreOutput::Chat(
                ImageAttachmentAdded { .. }
                | ImageAttachmentRemoved { .. }
                | ImageAttachmentRetryRequested { .. },
            ) => {
                // Inline images are already fully validated local data. There is no upload route.
            }
        }
        cx.notify();
    }

    fn admit_archive(
        &mut self,
        conversation: ConversationKey,
        mutation: crate::chat::MutationId,
        restore: bool,
        cx: &mut Context<Self>,
    ) {
        let workspace = self
            .agents
            .host()
            .read(cx)
            .catalog
            .read(cx)
            .snapshot()
            .conversation(&conversation)
            .map(|row| row.workspace_key.clone());
        let Some(workspace) = workspace else {
            let owner = self
                .agents
                .host()
                .read(cx)
                .materialized_workspaces()
                .find(|(_, store)| {
                    store
                        .read(cx)
                        .snapshot()
                        .session_archive
                        .contains_key(&conversation)
                })
                .map(|(_, store)| store.clone());
            if let Some(store) = owner {
                store.update(cx, |store, cx| {
                    store.conversation_archive_failed(
                        &conversation,
                        "Conversation workspace is no longer available.",
                    );
                    cx.notify();
                });
            }
            return;
        };
        let request = super::chat_protocol::MutationOnlyRequest {
            mutation_id: Some(mutation.as_str().to_owned()),
        };
        let result = if restore {
            self.chat
                .transport
                .unarchive_agent(conversation.id().to_owned(), request)
        } else {
            self.chat
                .transport
                .archive_agent(conversation.id().to_owned(), request)
        };
        match result {
            Ok(id) => {
                let provenance = if restore {
                    super::chat_state::RequestProvenance::Restore {
                        workspace,
                        conversation,
                        mutation,
                    }
                } else {
                    super::chat_state::RequestProvenance::Archive {
                        workspace,
                        conversation,
                        mutation,
                    }
                };
                self.chat.provenance.insert(id, provenance);
            }
            Err(error) => {
                if let Some(store) = self.existing_workspace(&workspace, cx) {
                    store.update(cx, |store, cx| {
                        store.conversation_archive_failed(&conversation, error.message);
                        cx.notify();
                    });
                }
            }
        }
    }

    fn admit_chat_mutation<F, P, E>(
        &mut self,
        conversation: ConversationKey,
        mutation: crate::chat::ChatMutationId,
        cx: &mut Context<Self>,
        admit: F,
        provenance: P,
        failure: E,
    ) where
        F: FnOnce(&super::ChatTransport, String) -> Result<super::ChatRequestId, UserError>,
        P: FnOnce(
            ConversationKey,
            crate::chat::ChatMutationId,
        ) -> super::chat_state::RequestProvenance,
        E: FnOnce(&mut crate::chat::ChatAuthoritativeWriter<'_>, Arc<str>),
    {
        match admit(&self.chat.transport, conversation.id().to_owned()) {
            Ok(id) => {
                self.chat
                    .provenance
                    .insert(id, provenance(conversation, mutation));
            }
            Err(error) => {
                if let Some(store) = self.existing_chat(&conversation, cx) {
                    store.update(cx, |store, cx| {
                        let mut writer = store.authoritative();
                        failure(&mut writer, Arc::from(error.message));
                        cx.notify();
                    });
                }
            }
        }
    }

    fn draft_timestamp_observe(&mut self, conversation: &ConversationKey, value: Option<i64>) {
        if let Some(value) = value {
            self.chat
                .draft_timestamp_floor
                .entry(conversation.clone())
                .and_modify(|floor| *floor = (*floor).max(value))
                .or_insert(value);
        }
    }

    fn draft_timestamp_next(&mut self, conversation: &ConversationKey) -> i64 {
        let now = current_time_millis();
        let floor = self
            .chat
            .draft_timestamp_floor
            .get(conversation)
            .copied()
            .unwrap_or(i64::MIN);
        let value = now.max(floor.saturating_add(1));
        self.chat
            .draft_timestamp_floor
            .insert(conversation.clone(), value);
        value
    }

    fn chat_availability(&self, cx: &gpui::App) -> ChatAvailability {
        match self.agents.host().read(cx).availability() {
            AgentAvailability::Online => ChatAvailability::Online,
            AgentAvailability::Draining { .. } => ChatAvailability::Unavailable {
                reason: Arc::from("Happy Agent is draining"),
            },
            AgentAvailability::Connecting | AgentAvailability::Reconnecting { .. } => {
                ChatAvailability::Unavailable {
                    reason: Arc::from("Happy Agent is reconnecting"),
                }
            }
            AgentAvailability::Offline { .. } | AgentAvailability::Error { .. } => {
                ChatAvailability::Unavailable {
                    reason: Arc::from("Happy Agent is offline"),
                }
            }
        }
    }
}

fn current_time_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn file_payload(bytes: Arc<[u8]>) -> Result<DocumentPayload, String> {
    match std::str::from_utf8(&bytes) {
        Ok(text) if bytes.len() <= MAX_EDITOR_BYTES => {
            Ok(DocumentPayload::EditableText(Arc::from(text)))
        }
        Ok(text) => Ok(DocumentPayload::ReadOnlyText(Arc::from(text))),
        Err(_) => Ok(DocumentPayload::Binary(bytes)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectivity::protocol::*;
    use crate::connectivity::transport::UserError;
    use gpui::TestAppContext;

    fn unmounted(cx: &mut Context<ConnectivityController>) -> ConnectivityController {
        ConnectivityController {
            agents: AgentRegistry::new(cx),
            transport: None,
            initial_phase: InitialPhase::Checking,
            onboarding_failure: None,
            pending_mutation: None,
            provider_rows: Vec::new(),
            providers_continue_required: false,
            profile_version: None,
            profile_name: None,
            profile_email: None,
            setup_owed: None,
            live_mutations: false,
            mounted: false,
            chat: super::super::chat_state::ChatConnectivity::new(Arc::new(
                super::super::start_chat_transport(TransportOptions::default()),
            )),
            files: Arc::new(crate::files::start_file_transport(
                TransportOptions::default(),
            )),
            file_output_tx: async_channel::bounded(crate::files::MAX_PENDING_REQUESTS).0,
            file_provenance: HashMap::new(),
            file_cache_order: VecDeque::new(),
            workspace_persistence: None,
            workspace_persistence_error: None,
            workspace_persistence_error_workspace: None,
        }
    }

    fn snapshot(
        profile: bool,
        providers: bool,
        project: bool,
        completed: bool,
    ) -> DesktopBootstrap {
        DesktopBootstrap {
            cursor: "cursor-1".into(),
            config: CatalogSnapshot {
                defaults: CatalogDefaults {
                    effort: "medium".into(),
                    model_id: "model".into(),
                    permission_mode: PermissionMode::WorkspaceWrite,
                    provider_id: "provider".into(),
                },
                models: BTreeMap::new(),
                providers: BTreeMap::new(),
            },
            onboarding: OnboardingState {
                completed,
                steps: OnboardingSteps {
                    profile: CompletionStep { done: profile },
                    providers: ProviderCompletionStep {
                        done: providers,
                        signed_in: Vec::new(),
                    },
                    project: CompletionStep { done: project },
                },
            },
            profile: Profile {
                name: Some("Happy User".into()),
                email: Some("happy@example.com".into()),
                photo: None,
                updated_at: 1,
                version: "profile-v1".into(),
            },
            projects: Vec::new(),
            workspaces: Vec::new(),
            bots: Vec::new(),
        }
    }

    #[gpui::test]
    fn draining_stream_keeps_lifetime_mounted_and_disables_live_mutations(cx: &mut TestAppContext) {
        let controller = cx.new(ConnectivityController::fixture_mounted);
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::StreamHello(EventStreamHello {
                    cursor: "cursor-draining".into(),
                    gap: false,
                    resumed: true,
                    connected_at: 1,
                    daemon_id: Some("daemon".into()),
                    daemon_started_at: Some(1),
                    draining: Some(true),
                }),
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert!(controller.mounted());
            assert!(!controller.live_mutations_available());
            assert!(matches!(
                controller
                    .agents()
                    .host()
                    .read_with(cx, |host, _| host.availability().clone()),
                AgentAvailability::Draining { .. }
            ));
        });
    }

    #[gpui::test]
    fn mounted_host_namespace_and_snapshot_survive_route_failure(cx: &mut TestAppContext) {
        let controller = cx.new(ConnectivityController::fixture_mounted);
        let host = controller.read_with(cx, |controller, _| controller.agents().host().clone());
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::Offline {
                    error: UserError {
                        kind: UserErrorKind::Unavailable,
                        message: "route unavailable".into(),
                        api: None,
                    },
                },
                cx,
            );
            controller.apply(
                WorkerEvent::Reconnecting {
                    attempt: 4,
                    error: Some(UserError {
                        kind: UserErrorKind::Unavailable,
                        message: "retrying".into(),
                        api: None,
                    }),
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert!(controller.mounted());
            assert_eq!(controller.agents().host(), &host);
            assert_eq!(controller.agents().known().count(), 1);
            assert_eq!(
                host.read_with(cx, |host, _| host.namespace().as_str().to_owned()),
                "host:local"
            );
            assert!(matches!(
                host.read_with(cx, |host, _| host.availability().clone()),
                AgentAvailability::Reconnecting { attempt: 4, .. }
            ));
        });
    }

    #[gpui::test]
    fn startup_failure_keeps_install_retry_provenance(cx: &mut TestAppContext) {
        let controller = cx.new(unmounted);
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::AgentMissing {
                    message: "managed route absent".into(),
                    installable: false,
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert_eq!(controller.setup_owed(), Some(true));
            assert!(matches!(
                controller.initial_phase(),
                InitialPhase::AgentMissing {
                    installable: false,
                    ..
                }
            ));
        });
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::InstallFailed {
                    message: "download failed".into(),
                },
                cx,
            );
        });
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::Starting {
                    message: "partially started daemon".into(),
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert!(matches!(
                controller.initial_phase(),
                InitialPhase::Failed {
                    retry: InitialRetry::Install,
                    ..
                }
            ));
        });
    }

    #[gpui::test]
    fn onboarding_snapshot_uses_authoritative_step_order_and_then_mounts(cx: &mut TestAppContext) {
        let controller = cx.new(unmounted);
        for (value, expected) in [
            (
                snapshot(false, false, false, false),
                InitialPhase::ProfileRequired,
            ),
            (
                snapshot(true, false, false, false),
                InitialPhase::ProvidersMissing,
            ),
            (
                snapshot(true, true, false, false),
                InitialPhase::FirstProject,
            ),
        ] {
            controller.update(cx, |controller, cx| {
                controller.apply(
                    WorkerEvent::Reconciled {
                        snapshot: value,
                        git: None,
                    },
                    cx,
                );
            });
            controller.read_with(cx, |controller, _| {
                assert_eq!(controller.initial_phase(), &expected);
                assert!(!controller.mounted());
                assert_eq!(controller.setup_owed(), Some(true));
            });
        }
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::Reconciled {
                    snapshot: snapshot(true, true, true, false),
                    git: None,
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert!(!controller.mounted());
            assert_eq!(controller.setup_owed(), Some(true));
            assert_eq!(
                controller.initial_phase(),
                &InitialPhase::CompletionRequired
            );
            assert_eq!(
                controller.profile_defaults(),
                (Some("Happy User"), Some("happy@example.com"))
            );
        });
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::Reconciled {
                    snapshot: snapshot(true, true, true, true),
                    git: None,
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert!(controller.mounted());
            assert_eq!(controller.setup_owed(), Some(false));
        });
    }

    #[gpui::test]
    fn mutation_identity_clears_errors_and_ignores_stale_profile_failure(cx: &mut TestAppContext) {
        let controller = cx.new(unmounted);
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::Reconciled {
                    snapshot: snapshot(false, false, false, false),
                    git: None,
                },
                cx,
            );
            controller.pending_mutation = Some(PendingOnboardingMutation {
                id: MutationId(0),
                kind: OnboardingMutationKind::Profile,
            });
            controller.apply(
                WorkerEvent::OnboardingMutationFailed {
                    id: MutationId(0),
                    kind: OnboardingMutationKind::Profile,
                    error: UserError {
                        kind: UserErrorKind::Api,
                        message: "old error".into(),
                        api: None,
                    },
                    snapshot: None,
                },
                cx,
            );
            controller.apply(
                WorkerEvent::OnboardingMutationStarted {
                    id: MutationId(1),
                    kind: OnboardingMutationKind::Profile,
                },
                cx,
            );
            controller.apply(
                WorkerEvent::OnboardingMutationStarted {
                    id: MutationId(2),
                    kind: OnboardingMutationKind::Providers,
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert_eq!(
                controller.pending_mutation(),
                Some(PendingOnboardingMutation {
                    id: MutationId(1),
                    kind: OnboardingMutationKind::Profile,
                })
            );
            assert_eq!(controller.onboarding_error(), None);
        });

        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::OnboardingMutationSucceeded {
                    id: MutationId(1),
                    kind: OnboardingMutationKind::Profile,
                    snapshot: snapshot(true, false, false, false),
                    provider_rows: None,
                },
                cx,
            );
            controller.apply(
                WorkerEvent::OnboardingMutationFailed {
                    id: MutationId(1),
                    kind: OnboardingMutationKind::Profile,
                    error: UserError {
                        kind: UserErrorKind::Api,
                        message: "stale profile failure".into(),
                        api: None,
                    },
                    snapshot: None,
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert_eq!(controller.initial_phase(), &InitialPhase::ProvidersMissing);
            assert_eq!(controller.pending_mutation(), None);
            assert_eq!(controller.onboarding_error(), None);
        });
    }

    #[gpui::test]
    fn profile_conflict_adopts_authoritative_snapshot_before_retry(cx: &mut TestAppContext) {
        let controller = cx.new(unmounted);
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::Reconciled {
                    snapshot: snapshot(false, false, false, false),
                    git: None,
                },
                cx,
            );
            controller.pending_mutation = Some(PendingOnboardingMutation {
                id: MutationId(12),
                kind: OnboardingMutationKind::Profile,
            });
            let mut current = snapshot(false, false, false, false);
            current.profile.version = "profile-v2".into();
            current.profile.name = Some("Current name".into());
            controller.apply(
                WorkerEvent::OnboardingMutationFailed {
                    id: MutationId(12),
                    kind: OnboardingMutationKind::Profile,
                    error: UserError {
                        kind: UserErrorKind::Api,
                        message: "The profile changed.".into(),
                        api: Some(crate::connectivity::transport::ApiError {
                            status: 409,
                            code: Some("conflict".into()),
                            message: "The profile changed.".into(),
                            body: Some(serde_json::json!({
                                "currentVersion": "profile-v2",
                                "profile": { "name": "Current name" }
                            })),
                        }),
                    },
                    snapshot: Some(current),
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert_eq!(controller.profile_version.as_deref(), Some("profile-v2"));
            assert_eq!(controller.profile_defaults().0, Some("Current name"));
            assert!(controller.onboarding_failure().is_some());
        });
    }

    #[gpui::test]
    fn provider_success_holds_continue_before_first_project(cx: &mut TestAppContext) {
        let controller = cx.new(unmounted);
        let rows = vec![ProviderOnboardingRow {
            id: OnboardingProviderId::Claude,
            command_path: Some("/resolved/bin/claude".into()),
            scan: Some(ProviderScanResult {
                credentials: ProviderCredentialStatus::Available,
                enabled: true,
                enablement: ProviderEnablement::Scan,
                provider_id: "claude".into(),
                remembered: true,
            }),
            authentication: Some(ProviderAuthenticationState::Valid),
        }];
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::Reconciled {
                    snapshot: snapshot(true, false, false, false),
                    git: None,
                },
                cx,
            );
            controller.apply(
                WorkerEvent::OnboardingMutationStarted {
                    id: MutationId(9),
                    kind: OnboardingMutationKind::Providers,
                },
                cx,
            );
            // An SSE reconciliation can race the mutation response. It must not
            // advance past the provider result presentation.
            controller.apply(
                WorkerEvent::Reconciled {
                    snapshot: snapshot(true, true, false, false),
                    git: None,
                },
                cx,
            );
            controller.apply(
                WorkerEvent::OnboardingMutationSucceeded {
                    id: MutationId(9),
                    kind: OnboardingMutationKind::Providers,
                    snapshot: snapshot(true, true, false, false),
                    provider_rows: Some(rows.clone()),
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert_eq!(controller.initial_phase(), &InitialPhase::ProvidersMissing);
            assert!(controller.providers_continue_available());
            assert_eq!(controller.provider_rows(), rows.as_slice());
            assert_eq!(
                controller.provider_rows()[0].authentication,
                Some(ProviderAuthenticationState::Valid)
            );
        });
        controller.update(cx, |controller, _| {
            assert!(controller.providers_continue());
            assert!(!controller.providers_continue());
        });
        controller.read_with(cx, |controller, _| {
            assert_eq!(controller.initial_phase(), &InitialPhase::FirstProject);
            assert!(!controller.providers_continue_available());
        });
    }

    #[gpui::test]
    fn protocol_refusal_before_mount_is_transport_retry_not_install_retry(cx: &mut TestAppContext) {
        let controller = cx.new(unmounted);
        controller.update(cx, |controller, cx| {
            controller.apply(
                WorkerEvent::Error {
                    error: UserError {
                        kind: UserErrorKind::Protocol,
                        message: "protocol mismatch".into(),
                        api: None,
                    },
                },
                cx,
            );
        });
        controller.read_with(cx, |controller, _| {
            assert!(matches!(
                controller.initial_phase(),
                InitialPhase::Failed {
                    retry: InitialRetry::Transport,
                    ..
                }
            ));
        });
    }
}
