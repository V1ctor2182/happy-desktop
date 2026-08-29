//! Stable GPUI-owned Happy Agent lifetimes.
//!
//! Transport availability is mutable state on a long-lived entity. A route
//! failure never replaces its namespace, authoritative snapshot, or entity ID.

use std::{collections::BTreeMap, sync::Arc};

use gpui::{AppContext, Context, Entity};

#[allow(unused_imports)] // Public state projection; shell adoption removes this allowance.
pub use super::transport::{
    MutationId, OnboardingMutationKind, OnboardingProviderId, ProviderAuthenticationState,
    ProviderOnboardingRow,
};
use super::{
    AgentCatalogStore, DesktopBootstrap, GitState, HostTransport, TransportOptions, UserError,
    UserErrorKind, WorkerEvent, start_host_transport,
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
}

impl ConnectivityController {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let transport = start_host_transport(TransportOptions::default());
        let receiver = transport.receiver();
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
        }
    }

    pub fn agents(&self) -> &AgentRegistry {
        &self.agents
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
                // Stream metadata is transport state, never durable product state.
            }
            WorkerEvent::Draining { message } => {
                self.live_mutations = false;
                self.agents.host().update(cx, |host, cx| {
                    host.availability = AgentAvailability::Draining { message };
                    cx.notify();
                });
            }
            WorkerEvent::EventHint(hint) => {
                let _delivery_position = (hint.cursor, hint.event_type);
                // Delivery hints never become product state.
            }
            WorkerEvent::Reconnecting { attempt, error } => {
                self.live_mutations = false;
                self.agents.host().update(cx, |host, cx| {
                    host.availability = AgentAvailability::Reconnecting { attempt, error };
                    cx.notify();
                });
            }
            WorkerEvent::Offline { error } => {
                self.live_mutations = false;
                self.agents.host().update(cx, |host, cx| {
                    host.availability = AgentAvailability::Offline { error };
                    cx.notify();
                });
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
        catalog.update(cx, |catalog, cx| {
            catalog.reconcile(&snapshot, next_git.as_ref());
            cx.notify();
        });
        host_entity.update(cx, |host, cx| {
            if let Some(version) = daemon_version {
                host.daemon_version = Some(version);
            }
            host.git = next_git;
            host.snapshot = Some(Arc::new(snapshot));
            cx.notify();
        });
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
