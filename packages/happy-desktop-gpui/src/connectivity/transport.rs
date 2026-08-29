//! Blocking Unix-socket transport hosted on one worker thread.
//!
//! Protocol v23 does not publish a typed peer-route contract. This module
//! therefore connects only to the local host. It must not invent peer URLs.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    env,
    ffi::OsString,
    fmt,
    fs::File,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use async_channel::{Receiver, Sender};
use reqwest::{
    blocking::{Client, Response},
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, IF_MATCH},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use super::installer::{
    DaemonCommand, HappyDaemonPaths, InstallOptions, InstallProgress as InstallerProgress,
    capture_login_shell_environment, happy_home_resolve, install_latest,
};
use super::protocol::{
    BotListResponse, ConfigResponse, DesktopBootstrap, EventHint, EventHintPayload,
    EventStreamHello, GitState, GitStateResponse, HAPPY_AGENT_PROTOCOL_VERSION,
    HappyAgentEventType, HealthResponse, OnboardingCompletedResponse, OnboardingState,
    ProfileResponse, ProjectListResponse, ProviderScanResponse, ProviderScanResult,
    ProviderVerificationLevel, ProviderVerificationResponse, ProviderVerificationStatus,
    WatchGitRequest, WatchGitResponse, WorkspaceListResponse,
};

const HOST_EVENT_CAPACITY: usize = 4;
const MAX_DAEMON_RESPONSE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_API_ERROR_BODY_BYTES: u64 = 1024 * 1024;
const MAX_API_ERROR_NODES: usize = 4096;
const MAX_API_ERROR_STRING_BYTES: usize = 4096;
const MAX_API_ERROR_CODE_BYTES: usize = 256;
const MAX_SSE_LINE_BYTES: usize = 1024 * 1024;
const MAX_SSE_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MAX_SSE_EVENT_BYTES: usize = 256;
const MAX_SSE_FRAME_LINES: usize = 16_384;
const MAX_SECRET_TOKEN_BYTES: u64 = 64 * 1024;

/// Stable daemon failure information safe to present to product code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApiError {
    pub status: u16,
    pub code: Option<String>,
    pub message: String,
    /// The complete extensible protocol error object, including conflict fields
    /// such as `currentVersion` and the authoritative current resource.
    pub body: Option<serde_json::Value>,
}
/// A displayable transport failure. It never contains the bearer token.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserError {
    pub kind: UserErrorKind,
    pub message: String,
    pub api: Option<ApiError>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UserErrorKind {
    Unavailable,
    NotReady,
    StreamIdle,
    Api,
    Protocol,
    Setup,
}
impl fmt::Display for UserError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for UserError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct MutationId(pub u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnboardingMutationKind {
    Profile,
    Providers,
    Project,
    Complete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnboardingProviderId {
    Claude,
    Codex,
    Grok,
}
impl OnboardingProviderId {
    pub const ALL: [Self; 3] = [Self::Claude, Self::Codex, Self::Grok];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Grok => "grok",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderAuthenticationState {
    Valid,
    Invalid,
    Error,
}

/// The native host and daemon answers for one fixed onboarding provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderOnboardingRow {
    pub id: OnboardingProviderId,
    /// Exact executable found on the already-resolved login PATH.
    pub command_path: Option<PathBuf>,
    /// The matching entry from the completed daemon scan, if it reported one.
    pub scan: Option<ProviderScanResult>,
    /// `None` only when no command exists, so no auth request was made.
    pub authentication: Option<ProviderAuthenticationState>,
}

#[derive(Clone, Debug)]
pub enum WorkerEvent {
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
        received_bytes: Option<u64>,
        total_bytes: Option<u64>,
    },
    Connecting,
    /// The first complete authoritative v23 projection.
    Bootstrap {
        snapshot: DesktopBootstrap,
        git: BTreeMap<String, GitState>,
        daemon_version: String,
    },
    /// A replacement authoritative snapshot after an SSE delivery hint or gap.
    Reconciled {
        snapshot: DesktopBootstrap,
        /// `None` preserves the current computed Git snapshots.
        git: Option<BTreeMap<String, GitState>>,
    },
    StreamHello(EventStreamHello),
    Draining {
        message: String,
    },
    /// Delivery only. Never mutate durable state from this payload.
    EventHint(EventHint),
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
    OnboardingMutationStarted {
        id: MutationId,
        kind: OnboardingMutationKind,
    },
    OnboardingMutationSucceeded {
        id: MutationId,
        kind: OnboardingMutationKind,
        snapshot: DesktopBootstrap,
        provider_rows: Option<Vec<ProviderOnboardingRow>>,
    },
    OnboardingMutationFailed {
        id: MutationId,
        kind: OnboardingMutationKind,
        error: UserError,
        snapshot: Option<DesktopBootstrap>,
    },
    InstallFailed {
        message: String,
    },
    Stopped,
}

#[derive(Clone, Debug)]
pub struct TransportOptions {
    /// Environment captured by the caller. An empty map uses this process's environment.
    pub environment: BTreeMap<String, String>,
    pub home_directory: Option<PathBuf>,
    pub reconnect_delay: Duration,
    pub reconnect_max_delay: Duration,
}
impl Default for TransportOptions {
    fn default() -> Self {
        Self {
            environment: BTreeMap::new(),
            home_directory: None,
            reconnect_delay: Duration::from_millis(250),
            reconnect_max_delay: Duration::from_secs(5),
        }
    }
}

#[derive(Clone)]
pub struct CancelHandle {
    cancelled: Arc<AtomicBool>,
    thread: thread::Thread,
}
impl CancelHandle {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.thread.unpark();
    }
    /// Accelerates a pending reconnect without changing connection ownership.
    pub fn retry(&self) {
        self.thread.unpark();
    }
}

pub struct HostTransport {
    events: Receiver<WorkerEvent>,
    event_sender: Sender<WorkerEvent>,
    options: TransportOptions,
    resolved_environment: Arc<Mutex<Option<BTreeMap<String, String>>>>,
    installing: Arc<AtomicBool>,
    onboarding_mutating: Arc<AtomicBool>,
    next_mutation_id: Arc<AtomicU64>,
    authority_gate: Arc<Mutex<()>>,
    cancel: CancelHandle,
}
impl HostTransport {
    pub fn receiver(&self) -> Receiver<WorkerEvent> {
        self.events.clone()
    }
    pub fn retry(&self) {
        self.cancel.retry();
    }

    /// Dismisses initial onboarding through the daemon's idempotent owned route.
    pub fn profile_update(&self, name: String, email: String, version: String) -> bool {
        self.onboarding_mutate(OnboardingMutation::Profile {
            name,
            email,
            version,
        })
    }

    pub fn providers_scan(&self) -> bool {
        self.onboarding_mutate(OnboardingMutation::ProvidersScan)
    }

    pub fn project_register(&self, path: PathBuf) -> bool {
        self.onboarding_mutate(OnboardingMutation::Project { path })
    }

    pub fn onboarding_complete(&self) -> bool {
        self.onboarding_mutate(OnboardingMutation::Complete)
    }

    fn effective_options(&self) -> TransportOptions {
        let mut options = self.options.clone();
        if let Ok(environment) = self.resolved_environment.lock()
            && let Some(environment) = environment.as_ref()
        {
            options.environment = environment.clone();
        }
        options
    }

    pub fn install_start(&self) {
        if self.installing.swap(true, Ordering::AcqRel) {
            return;
        }
        let options = self.effective_options();
        let sender = self.event_sender.clone();
        let failure_sender = sender.clone();
        let installing = self.installing.clone();
        let failure_installing = installing.clone();
        let retry = self.cancel.clone();
        let spawned = thread::Builder::new()
            .name("happy-agent-installer".into())
            .spawn(move || {
                let result = install_and_start(&options, |progress| match progress {
                    InstallerProgress::Status(message) => send(
                        &sender,
                        WorkerEvent::Installing {
                            message,
                            received_bytes: None,
                            total_bytes: None,
                        },
                    ),
                    InstallerProgress::Download {
                        received_bytes,
                        total_bytes,
                    } => send(
                        &sender,
                        WorkerEvent::Installing {
                            message: "Downloading Happy Agent.".into(),
                            received_bytes: Some(received_bytes),
                            total_bytes: Some(total_bytes),
                        },
                    ),
                });
                match result {
                    Ok(()) => {
                        send(
                            &sender,
                            WorkerEvent::Starting {
                                message: "Waiting for Happy Agent to become ready.".into(),
                            },
                        );
                        retry.retry();
                    }
                    Err(error) => send(
                        &sender,
                        WorkerEvent::InstallFailed {
                            message: error.message,
                        },
                    ),
                }
                installing.store(false, Ordering::Release);
            });
        if spawned.is_err() {
            failure_installing.store(false, Ordering::Release);
            send(
                &failure_sender,
                WorkerEvent::InstallFailed {
                    message: "Could not start the Happy Agent installer.".into(),
                },
            );
        }
    }

    fn onboarding_mutate(&self, mutation: OnboardingMutation) -> bool {
        if self.onboarding_mutating.swap(true, Ordering::AcqRel) {
            return false;
        }
        let id = MutationId(self.next_mutation_id.fetch_add(1, Ordering::Relaxed));
        let kind = mutation.kind();
        let mutation_key = format!("happy-gpui-{}-{}", std::process::id(), id.0);
        send(
            &self.event_sender,
            WorkerEvent::OnboardingMutationStarted { id, kind },
        );
        let options = self.effective_options();
        let sender = self.event_sender.clone();
        let mutating = self.onboarding_mutating.clone();
        let failure_sender = sender.clone();
        let failure_mutating = mutating.clone();
        let authority_gate = self.authority_gate.clone();
        if thread::Builder::new()
            .name("happy-agent-onboarding".into())
            .spawn(move || {
                // Mutation and the snapshot it returns share one authority gate with
                // stream reconciliation. This makes channel order match server order:
                // a pre-mutation refetch cannot arrive after the mutation snapshot.
                let authority = authority_enter(&authority_gate);
                let terminal = match run_onboarding_mutation(&options, mutation, &mutation_key) {
                    Ok(output) => WorkerEvent::OnboardingMutationSucceeded {
                        id,
                        kind,
                        snapshot: output.snapshot,
                        provider_rows: output.provider_rows,
                    },
                    Err(failure) => WorkerEvent::OnboardingMutationFailed {
                        id,
                        kind,
                        error: failure.error,
                        snapshot: failure.snapshot,
                    },
                };
                // Clear transport admission before publishing the terminal event.
                // Once the UI can render the next step, its first activation must
                // not race a stale busy flag from this completed request.
                mutating.store(false, Ordering::Release);
                send(&sender, terminal);
                drop(authority);
            })
            .is_err()
        {
            failure_mutating.store(false, Ordering::Release);
            send(
                &failure_sender,
                WorkerEvent::OnboardingMutationFailed {
                    id,
                    kind,
                    error: UserError {
                        kind: UserErrorKind::Setup,
                        message: "Could not start the onboarding request.".into(),
                        api: None,
                    },
                    snapshot: None,
                },
            );
        }
        true
    }
}
impl Drop for HostTransport {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
/// Starts all filesystem, process, HTTP, and SSE work outside the UI thread.
pub fn start_host_transport(options: TransportOptions) -> HostTransport {
    let (sender, receiver) = async_channel::bounded(HOST_EVENT_CAPACITY);
    let event_sender = sender.clone();
    let worker_options = options.clone();
    let resolved_environment = Arc::new(Mutex::new(None));
    let worker_environment = resolved_environment.clone();
    let authority_gate = Arc::new(Mutex::new(()));
    let worker_authority_gate = authority_gate.clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = cancelled.clone();
    let handle = thread::Builder::new()
        .name("happy-agent-host".into())
        .spawn(move || {
            worker(
                worker_options,
                sender,
                worker_cancelled,
                worker_environment,
                worker_authority_gate,
            )
        })
        .expect("host transport worker should spawn");
    let cancel = CancelHandle {
        cancelled,
        thread: handle.thread().clone(),
    };
    // The worker owns its lifecycle. Dropping JoinHandle detaches without touching the daemon.
    drop(handle);
    HostTransport {
        events: receiver,
        event_sender,
        options,
        resolved_environment,
        installing: Arc::new(AtomicBool::new(false)),
        onboarding_mutating: Arc::new(AtomicBool::new(false)),
        next_mutation_id: Arc::new(AtomicU64::new(1)),
        authority_gate,
        cancel,
    }
}

fn agent_missing_message(externally_managed: bool) -> &'static str {
    if externally_managed {
        "The owner-managed Happy Agent route is unavailable. Check the host that supplied this socket and token; Happy will keep reconnecting."
    } else {
        "No running Happy Agent was found. Happy will keep looking."
    }
}

fn managed_route(socket: Option<&str>, token: Option<&str>) -> bool {
    socket.is_some_and(|value| !value.trim().is_empty())
        && token.is_some_and(|value| !value.trim().is_empty())
}

fn reconnect_backoff(base: Duration, maximum: Duration, attempt: u32) -> Duration {
    let exponent = attempt.saturating_sub(1).min(31);
    base.checked_mul(1_u32 << exponent)
        .unwrap_or(maximum)
        .min(maximum)
}

fn stream_is_stable(hello_elapsed: Option<Duration>, accepted_event: bool) -> bool {
    accepted_event || hello_elapsed.is_some_and(|elapsed| elapsed >= Duration::from_secs(30))
}

fn authority_enter(gate: &Mutex<()>) -> std::sync::MutexGuard<'_, ()> {
    gate.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ReconcilePlan {
    config: bool,
    onboarding: bool,
    profile: bool,
    projects: bool,
    workspaces: bool,
    bots: bool,
    git_all: bool,
    git_workspaces: BTreeSet<String>,
}

impl ReconcilePlan {
    fn include_hint(&mut self, hint: &EventHint) {
        match hint.event_type {
            HappyAgentEventType::ConfigUpdated => {
                self.config = true;
                self.onboarding = true;
            }
            HappyAgentEventType::ProfileUpdated => {
                self.profile = true;
                self.onboarding = true;
            }
            HappyAgentEventType::ProjectCreated | HappyAgentEventType::ProjectUpdated => {
                self.projects = true;
                self.workspaces = true;
                self.onboarding = true;
            }
            HappyAgentEventType::WorkspaceCreated | HappyAgentEventType::WorkspaceUpdated => {
                self.projects = true;
                self.workspaces = true;
            }
            HappyAgentEventType::BotCreated | HappyAgentEventType::BotUpdated => {
                self.bots = true;
                self.workspaces = true;
            }
            HappyAgentEventType::AgentCreated
            | HappyAgentEventType::AgentUpdated
            | HappyAgentEventType::ProcessStarted
            | HappyAgentEventType::ProcessUpdated
            | HappyAgentEventType::ProcessExited
            | HappyAgentEventType::QuestionCreated
            | HappyAgentEventType::QuestionUpdated
            | HappyAgentEventType::RunStarted
            | HappyAgentEventType::RunBoundary
            | HappyAgentEventType::RunFinished => {
                // These events can change facts embedded in an agent, but v23
                // does not name that agent's authoritative owner. Re-read all
                // three closed owner families rather than invent an owner.
                self.projects = true;
                self.workspaces = true;
                self.bots = true;
            }
            HappyAgentEventType::GitUpdated => {
                if let Some(workspace_id) = hint
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.workspace_id.as_ref())
                {
                    self.git_workspaces.insert(workspace_id.clone());
                } else {
                    self.git_all = true;
                }
            }
            _ => {}
        }
    }

    #[cfg(test)]
    fn include(&mut self, event_type: HappyAgentEventType) {
        self.include_hint(&EventHint {
            cursor: String::new(),
            event_type,
            payload: None,
        });
    }

    fn is_empty(&self) -> bool {
        self == &Self::default()
    }

    fn catalog_membership_changed(&self) -> bool {
        self.projects || self.workspaces || self.bots
    }
}

const GIT_WATCH_RENEWAL: Duration = Duration::from_secs(2 * 60);
const GIT_RETRY_DELAY: Duration = Duration::from_secs(5);

struct GitRefresh {
    full_watch_pending: bool,
    targeted_pending: BTreeSet<String>,
    next_watch_renewal: Instant,
    retry_at: Instant,
}

impl GitRefresh {
    fn after_initial_attempt(succeeded: bool) -> Self {
        let now = Instant::now();
        Self {
            full_watch_pending: !succeeded,
            targeted_pending: BTreeSet::new(),
            next_watch_renewal: if succeeded {
                now + GIT_WATCH_RENEWAL
            } else {
                now
            },
            retry_at: if succeeded {
                now
            } else {
                now + GIT_RETRY_DELAY
            },
        }
    }

    fn catalog_changed(&mut self) {
        self.full_watch_pending = true;
        self.targeted_pending.clear();
        self.retry_at = Instant::now();
    }

    fn target(&mut self, workspace_id: String, bootstrap: &DesktopBootstrap) {
        if catalog_git_targets(bootstrap).contains(&workspace_id) {
            self.targeted_pending.insert(workspace_id);
            self.retry_at = Instant::now();
        }
    }
}

fn resolve_login_environment(base: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let base_os: HashMap<OsString, OsString> = base
        .iter()
        .map(|(key, value)| (OsString::from(key), OsString::from(value)))
        .collect();
    let Some(shell) = base.get("SHELL").map(PathBuf::from) else {
        return base.clone();
    };
    let mut resolved = capture_login_shell_environment(&shell, &base_os, Duration::from_secs(30))
        .ok()
        .map(|environment| {
            environment
                .into_iter()
                .filter_map(|(key, value)| {
                    Some((key.into_string().ok()?, value.into_string().ok()?))
                })
                .collect()
        })
        .unwrap_or_else(|| base.clone());
    // Exact routes belong to the launching host. A login shell is allowed to
    // enrich PATH and normal user variables, but it must never redirect or
    // downgrade an inseparable socket/token pair supplied by that host.
    if managed_route(
        base.get("HAPPY_AGENT_SERVER_SOCKET_PATH")
            .map(String::as_str),
        base.get("HAPPY_AGENT_SERVER_TOKEN_PATH")
            .map(String::as_str),
    ) {
        for name in [
            "HAPPY_AGENT_SERVER_SOCKET_PATH",
            "HAPPY_AGENT_SERVER_TOKEN_PATH",
        ] {
            if let Some(value) = base.get(name) {
                resolved.insert(name.into(), value.clone());
            }
        }
    }
    resolved
}

fn install_and_start(
    options: &TransportOptions,
    progress: impl FnMut(InstallerProgress),
) -> Result<(), UserError> {
    let environment: HashMap<OsString, OsString> = if options.environment.is_empty() {
        env::vars_os().collect()
    } else {
        options
            .environment
            .iter()
            .map(|(key, value)| (OsString::from(key), OsString::from(value)))
            .collect()
    };
    if managed_route(
        environment
            .get(&OsString::from("HAPPY_AGENT_SERVER_SOCKET_PATH"))
            .and_then(|value| value.to_str()),
        environment
            .get(&OsString::from("HAPPY_AGENT_SERVER_TOKEN_PATH"))
            .and_then(|value| value.to_str()),
    ) {
        return Err(user_error(
            "This Happy Agent route is externally managed and cannot be installed here.",
        ));
    }
    let home = options
        .home_directory
        .clone()
        .or_else(|| environment.get(&OsString::from("HOME")).map(PathBuf::from))
        .ok_or_else(|| user_error("The home directory is unavailable."))?;
    let shell = environment
        .get(&OsString::from("SHELL"))
        .map(PathBuf::from)
        .ok_or_else(|| user_error("The user's configured login shell is unavailable."))?;
    let paths = HappyDaemonPaths::resolve(&environment, &home);
    let mut install_options =
        InstallOptions::native(shell).map_err(|error| user_error(error.to_string()))?;
    install_options.base_environment = environment.clone();
    install_options.resolved_environment = Some(environment);
    install_options.daemon_command = DaemonCommand::Reload;
    install_options.command_timeout = Duration::from_secs(75);
    let installed = install_latest(&install_options, &paths, progress)
        .map_err(|error| user_error(error.to_string()))?;
    let _installed_version = installed.version;
    Ok(())
}

fn worker(
    options: TransportOptions,
    sender: Sender<WorkerEvent>,
    cancelled: Arc<AtomicBool>,
    resolved_environment: Arc<Mutex<Option<BTreeMap<String, String>>>>,
    authority_gate: Arc<Mutex<()>>,
) {
    let base_environment = if options.environment.is_empty() {
        env::vars().collect()
    } else {
        options.environment.clone()
    };
    let environment = resolve_login_environment(&base_environment);
    if let Ok(mut shared) = resolved_environment.lock() {
        *shared = Some(environment.clone());
    }
    send(&sender, WorkerEvent::Checking);
    let paths = match DaemonPaths::resolve(&environment, options.home_directory.as_deref()) {
        Ok(value) => value,
        Err(error) => {
            send(&sender, WorkerEvent::Error { error });
            send(&sender, WorkerEvent::Stopped);
            return;
        }
    };
    let externally_managed = managed_route(
        environment
            .get("HAPPY_AGENT_SERVER_SOCKET_PATH")
            .map(String::as_str),
        environment
            .get("HAPPY_AGENT_SERVER_TOKEN_PATH")
            .map(String::as_str),
    );
    if !paths.socket_path.exists() || !paths.token_path.exists() {
        send(
            &sender,
            WorkerEvent::AgentMissing {
                message: agent_missing_message(externally_managed).into(),
                installable: !externally_managed,
            },
        );
    }
    let mut attempt = 0_u32;
    let mut announce_connecting = true;
    while !cancelled.load(Ordering::Acquire) {
        if announce_connecting {
            send(&sender, WorkerEvent::Connecting);
        }
        announce_connecting = true;
        let mut stream_stable = false;
        match connect_once(
            &paths,
            &sender,
            &cancelled,
            &mut stream_stable,
            &authority_gate,
        ) {
            Ok(()) => break,
            Err(error) => {
                if cancelled.load(Ordering::Acquire) {
                    break;
                }
                if stream_stable {
                    attempt = 0;
                }
                if error.kind == UserErrorKind::StreamIdle {
                    announce_connecting = false;
                    continue;
                }
                if error.kind == UserErrorKind::NotReady {
                    send(
                        &sender,
                        WorkerEvent::Starting {
                            message: error.message.clone(),
                        },
                    );
                } else if attempt == 0 && error.kind == UserErrorKind::Unavailable {
                    send(
                        &sender,
                        WorkerEvent::AgentMissing {
                            message: agent_missing_message(externally_managed).into(),
                            installable: !externally_managed,
                        },
                    );
                }
                attempt = attempt.saturating_add(1);
                if matches!(error.kind, UserErrorKind::Protocol | UserErrorKind::Setup) {
                    send(&sender, WorkerEvent::Error { error });
                } else {
                    send(
                        &sender,
                        WorkerEvent::Offline {
                            error: error.clone(),
                        },
                    );
                    send(
                        &sender,
                        WorkerEvent::Reconnecting {
                            attempt,
                            error: Some(error),
                        },
                    );
                }
            }
        }
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        thread::park_timeout(reconnect_backoff(
            options.reconnect_delay,
            options.reconnect_max_delay,
            attempt,
        ));
    }
    send(&sender, WorkerEvent::Stopped);
}

fn accept_stream_hello(
    cursor: &mut String,
    received_hello: &mut bool,
    hello: &EventStreamHello,
) -> Result<bool, UserError> {
    if *received_hello {
        return Err(protocol_error("duplicate stream hello"));
    }
    *received_hello = true;
    let state_lost = hello.gap || !hello.resumed;
    // A resumed hello names the daemon's current head, not the beginning of the
    // replay. Retain the last accepted cursor until replay advances it.
    if state_lost {
        *cursor = hello.cursor.clone();
    }
    Ok(state_lost)
}

fn accept_stream_event_cursor(
    cursor: &mut String,
    received_hello: bool,
    next: &str,
) -> Result<bool, UserError> {
    if !received_hello {
        return Err(protocol_error("event before stream hello"));
    }
    if next <= cursor.as_str() {
        return Ok(false);
    }
    *cursor = next.to_owned();
    Ok(true)
}

fn connect_once(
    paths: &DaemonPaths,
    sender: &Sender<WorkerEvent>,
    cancelled: &AtomicBool,
    stream_stable: &mut bool,
    authority_gate: &Mutex<()>,
) -> Result<(), UserError> {
    let token = SecretToken::read(&paths.token_path)?;
    let client = Client::builder()
        .unix_socket(paths.socket_path.clone())
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(transport_error)?;
    let stream_client = Client::builder()
        .unix_socket(paths.socket_path.clone())
        .timeout(Duration::from_secs(65))
        .build()
        .map_err(transport_error)?;
    let health: HealthResponse = get_json(&client, &token, "/v0/health")?;
    if health.version.protocol != HAPPY_AGENT_PROTOCOL_VERSION {
        return Err(UserError {
            kind: UserErrorKind::Protocol,
            message: format!(
                "Happy Agent protocol {} is not supported; this build requires protocol {}.",
                health.version.protocol, HAPPY_AGENT_PROTOCOL_VERSION
            ),
            api: None,
        });
    }
    if !daemon_version_at_least(&health.version.daemon, (0, 4, 24)) {
        return Err(UserError {
            kind: UserErrorKind::Protocol,
            message: format!(
                "Happy Agent {} is too old; this build requires 0.4.24 or newer.",
                health.version.daemon
            ),
            api: None,
        });
    }
    if !health.ready {
        return Err(UserError {
            kind: UserErrorKind::NotReady,
            message: "Happy Agent is still starting.".into(),
            api: None,
        });
    }
    let authority = authority_enter(authority_gate);
    let mut bootstrap: DesktopBootstrap = get_json(&client, &token, "/v0/bootstrap/desktop")?;
    // Git is a secondary projection. A failed watch must not block the
    // authoritative desktop bootstrap or the event stream.
    let initial_git = watch_catalog_git(&client, &token, &bootstrap);
    let initial_git_succeeded = initial_git.is_ok();
    let mut git = initial_git.unwrap_or_default();
    let mut git_refresh = GitRefresh::after_initial_attempt(initial_git_succeeded);
    let mut cursor = bootstrap.cursor.clone();
    send(
        sender,
        WorkerEvent::Bootstrap {
            snapshot: bootstrap.clone(),
            git: git.clone(),
            daemon_version: health.version.daemon.clone(),
        },
    );
    if health.draining {
        send(
            sender,
            WorkerEvent::Draining {
                message: "Happy Agent is draining and accepts no new live mutations.".into(),
            },
        );
    }
    drop(authority);
    let mut hello_at: Option<Instant> = None;
    while !cancelled.load(Ordering::Acquire) {
        let response = stream_request(&stream_client, &token, &cursor)?;
        let mut reader = BufReader::new(response);
        let mut reconcile_plan = ReconcilePlan::default();
        let mut received_hello = false;
        while !cancelled.load(Ordering::Acquire) {
            let frame = match read_sse_frame(&mut reader) {
                Ok(frame) => frame,
                Err(error) => {
                    if !reconcile_plan.is_empty() {
                        let _ = reconcile_difference(
                            &client,
                            &token,
                            sender,
                            &mut bootstrap,
                            &mut git,
                            &cursor,
                            std::mem::take(&mut reconcile_plan),
                            &mut git_refresh,
                            authority_gate,
                        );
                    }
                    if stream_is_stable(hello_at.map(|at| at.elapsed()), false) {
                        *stream_stable = true;
                    }
                    return Err(error);
                }
            };
            let Some(frame) = frame else {
                if !reconcile_plan.is_empty() {
                    let _ = reconcile_difference(
                        &client,
                        &token,
                        sender,
                        &mut bootstrap,
                        &mut git,
                        &cursor,
                        std::mem::take(&mut reconcile_plan),
                        &mut git_refresh,
                        authority_gate,
                    );
                }
                if cancelled.load(Ordering::Acquire) {
                    return Ok(());
                }
                if stream_is_stable(hello_at.map(|at| at.elapsed()), false) {
                    *stream_stable = stream_is_stable(None, true);
                }
                return Err(unavailable_error("Happy Agent event stream closed."));
            };
            if stream_is_stable(hello_at.map(|at| at.elapsed()), false) {
                *stream_stable = true;
            }
            // SSE heartbeats keep this loop active. Use them to renew the
            // deduplicated Git watch lease every two minutes and to retry any
            // secondary Git failure without affecting stream health.
            if Instant::now() >= git_refresh.retry_at
                && (git_refresh.full_watch_pending
                    || !git_refresh.targeted_pending.is_empty()
                    || Instant::now() >= git_refresh.next_watch_renewal)
            {
                let authority = authority_enter(authority_gate);
                if try_refresh_git(&client, &token, &bootstrap, &mut git, &mut git_refresh) {
                    send(
                        sender,
                        WorkerEvent::Reconciled {
                            snapshot: bootstrap.clone(),
                            git: Some(git.clone()),
                        },
                    );
                }
                drop(authority);
            }
            if frame.data.is_empty() {
                if !reconcile_plan.is_empty() && reader.buffer().is_empty() {
                    reconcile_difference(
                        &client,
                        &token,
                        sender,
                        &mut bootstrap,
                        &mut git,
                        &cursor,
                        std::mem::take(&mut reconcile_plan),
                        &mut git_refresh,
                        authority_gate,
                    )?;
                }
                continue;
            }
            if frame.event.as_deref() == Some("hello") {
                let hello: EventStreamHello =
                    serde_json::from_str(&frame.data).map_err(protocol_error)?;
                let state_lost = accept_stream_hello(&mut cursor, &mut received_hello, &hello)?;
                hello_at = Some(Instant::now());
                let draining = hello.draining == Some(true);
                send(sender, WorkerEvent::StreamHello(hello));
                if draining {
                    send(
                        sender,
                        WorkerEvent::Draining {
                            message: "Happy Agent is draining and accepts no new live mutations."
                                .into(),
                        },
                    );
                }
                if state_lost {
                    reconcile_desktop(
                        &client,
                        &token,
                        sender,
                        &mut bootstrap,
                        &mut git,
                        &mut cursor,
                        &mut git_refresh,
                        authority_gate,
                    )?;
                    reconcile_plan = ReconcilePlan::default();
                }
                continue;
            }
            #[derive(Deserialize)]
            struct Envelope {
                cursor: String,
                #[serde(rename = "type")]
                event_type: HappyAgentEventType,
                #[serde(default)]
                payload: Option<EventHintPayload>,
            }
            let event: Envelope = serde_json::from_str(&frame.data).map_err(protocol_error)?;
            if !accept_stream_event_cursor(&mut cursor, received_hello, &event.cursor)? {
                continue;
            }
            *stream_stable = stream_is_stable(None, true);
            let hint = EventHint {
                cursor: cursor.clone(),
                event_type: event.event_type,
                payload: event.payload,
            };
            send(sender, WorkerEvent::EventHint(hint.clone()));
            if hint.event_type == HappyAgentEventType::DaemonDraining {
                send(
                    sender,
                    WorkerEvent::Draining {
                        message: "Happy Agent is draining and accepts no new live mutations."
                            .into(),
                    },
                );
            }
            // Events are delivery hints only. Accumulate the affected authoritative
            // resource families while already-readable frames drain, then perform one
            // targeted reconciliation for that batch. Unchanged families retain their
            // existing typed snapshot values.
            reconcile_plan.include_hint(&hint);
            if !reconcile_plan.is_empty() && reader.buffer().is_empty() {
                reconcile_difference(
                    &client,
                    &token,
                    sender,
                    &mut bootstrap,
                    &mut git,
                    &cursor,
                    std::mem::take(&mut reconcile_plan),
                    &mut git_refresh,
                    authority_gate,
                )?;
            }
        }
    }
    Ok(())
}

fn reconcile_desktop(
    client: &Client,
    token: &SecretToken,
    sender: &Sender<WorkerEvent>,
    bootstrap: &mut DesktopBootstrap,
    git: &mut BTreeMap<String, GitState>,
    cursor: &mut String,
    git_refresh: &mut GitRefresh,
    authority_gate: &Mutex<()>,
) -> Result<(), UserError> {
    let authority = authority_enter(authority_gate);
    *bootstrap = get_json(client, token, "/v0/bootstrap/desktop")?;
    let git_pruned = retain_catalog_git(bootstrap, git);
    git_refresh.catalog_changed();
    let git_changed = try_refresh_git(client, token, bootstrap, git, git_refresh);
    *cursor = bootstrap.cursor.clone();
    send(
        sender,
        WorkerEvent::Reconciled {
            snapshot: bootstrap.clone(),
            git: (git_pruned || git_changed).then(|| git.clone()),
        },
    );
    drop(authority);
    Ok(())
}

const RECONCILE_QUIET: Duration = Duration::from_millis(20);

fn reconcile_difference(
    client: &Client,
    token: &SecretToken,
    sender: &Sender<WorkerEvent>,
    bootstrap: &mut DesktopBootstrap,
    git: &mut BTreeMap<String, GitState>,
    cursor: &str,
    plan: ReconcilePlan,
    git_refresh: &mut GitRefresh,
    authority_gate: &Mutex<()>,
) -> Result<(), UserError> {
    // Bound high-rate journals to at most one authoritative read batch per quiet
    // window. Frames already buffered were drained before this call; frames that
    // arrive during the window accumulate for the next single batch.
    thread::sleep(RECONCILE_QUIET);
    let authority = authority_enter(authority_gate);
    if plan.config {
        bootstrap.config = get_json::<ConfigResponse>(client, token, "/v0/config")?.config;
    }
    if plan.onboarding {
        bootstrap.onboarding = get_json::<OnboardingState>(client, token, "/v0/onboarding")?;
    }
    if plan.profile {
        bootstrap.profile = get_json::<ProfileResponse>(client, token, "/v0/profile")?.profile;
    }
    if plan.projects {
        bootstrap.projects =
            get_json::<ProjectListResponse>(client, token, "/v0/projects")?.projects;
    }
    if plan.workspaces {
        bootstrap.workspaces =
            get_json::<WorkspaceListResponse>(client, token, "/v0/workspaces")?.workspaces;
    }
    if plan.bots {
        bootstrap.bots = get_json::<BotListResponse>(client, token, "/v0/bots")?.bots;
    }

    let git_pruned = if plan.catalog_membership_changed() {
        retain_catalog_git(bootstrap, git)
    } else {
        false
    };
    if plan.catalog_membership_changed() || plan.git_all {
        git_refresh.catalog_changed();
    } else {
        for workspace_id in plan.git_workspaces {
            git_refresh.target(workspace_id, bootstrap);
        }
    }
    let git_changed = try_refresh_git(client, token, bootstrap, git, git_refresh);

    bootstrap.cursor = cursor.to_owned();
    send(
        sender,
        WorkerEvent::Reconciled {
            snapshot: bootstrap.clone(),
            git: (git_pruned || git_changed).then(|| git.clone()),
        },
    );
    drop(authority);
    Ok(())
}

fn try_refresh_git(
    client: &Client,
    token: &SecretToken,
    bootstrap: &DesktopBootstrap,
    git: &mut BTreeMap<String, GitState>,
    refresh: &mut GitRefresh,
) -> bool {
    let now = Instant::now();
    if now < refresh.retry_at {
        return false;
    }

    if refresh.full_watch_pending || now >= refresh.next_watch_renewal {
        match watch_catalog_git(client, token, bootstrap) {
            Ok(snapshots) => {
                *git = snapshots;
                refresh.full_watch_pending = false;
                refresh.targeted_pending.clear();
                refresh.next_watch_renewal = Instant::now() + GIT_WATCH_RENEWAL;
                refresh.retry_at = Instant::now();
                return true;
            }
            Err(_) => {
                // Keep the last good Git projection. The lease retry is
                // independent of the authoritative catalog and SSE lifetime.
                refresh.full_watch_pending = true;
                refresh.retry_at = Instant::now() + GIT_RETRY_DELAY;
                return false;
            }
        }
    }

    let valid_targets = catalog_git_targets(bootstrap);
    refresh
        .targeted_pending
        .retain(|workspace_id| valid_targets.contains(workspace_id));
    if refresh.targeted_pending.is_empty() {
        return false;
    }

    let pending: Vec<_> = refresh.targeted_pending.iter().cloned().collect();
    let mut changed = false;
    for workspace_id in pending {
        // This targeted route is explicitly part of protocol v23. IDs reach it
        // only after validation against the current authoritative catalog.
        let path = format!("/v0/workspaces/{workspace_id}/git");
        if let Ok(response) = get_json::<GitStateResponse>(client, token, &path) {
            git.insert(workspace_id.clone(), response.git);
            refresh.targeted_pending.remove(&workspace_id);
            changed = true;
        }
    }
    refresh.retry_at = if refresh.targeted_pending.is_empty() {
        Instant::now()
    } else {
        Instant::now() + GIT_RETRY_DELAY
    };
    changed
}

fn retain_catalog_git(bootstrap: &DesktopBootstrap, git: &mut BTreeMap<String, GitState>) -> bool {
    let valid_targets = catalog_git_targets(bootstrap);
    let previous_len = git.len();
    git.retain(|workspace_id, _| valid_targets.contains(workspace_id));
    git.len() != previous_len
}

fn catalog_git_targets(bootstrap: &DesktopBootstrap) -> BTreeSet<String> {
    let mut workspace_ids = BTreeSet::new();
    for project in &bootstrap.projects {
        if project.status == super::protocol::ProjectStatus::Active && project.archived_at.is_none()
        {
            workspace_ids.insert(project.id.clone());
        }
    }
    for workspace in &bootstrap.workspaces {
        if workspace.status == super::protocol::WorkspaceStatus::Active
            && workspace.archived_at.is_none()
        {
            workspace_ids.insert(workspace.id.clone());
        }
    }
    for bot in &bootstrap.bots {
        if bot.status == super::protocol::BotStatus::Active && bot.archived_at.is_none() {
            workspace_ids.insert(bot.workspace_id.clone());
        }
    }
    workspace_ids
}

fn watch_catalog_git(
    client: &Client,
    token: &SecretToken,
    bootstrap: &DesktopBootstrap,
) -> Result<BTreeMap<String, GitState>, UserError> {
    let response: WatchGitResponse = post_json(
        client,
        token,
        "/v0/git/watch",
        &WatchGitRequest {
            workspace_ids: catalog_git_targets(bootstrap).into_iter().collect(),
        },
    )?;
    Ok(response.snapshots)
}

#[derive(Clone, Debug)]
enum OnboardingMutation {
    Profile {
        name: String,
        email: String,
        version: String,
    },
    ProvidersScan,
    Project {
        path: PathBuf,
    },
    Complete,
}
impl OnboardingMutation {
    fn kind(&self) -> OnboardingMutationKind {
        match self {
            Self::Profile { .. } => OnboardingMutationKind::Profile,
            Self::ProvidersScan => OnboardingMutationKind::Providers,
            Self::Project { .. } => OnboardingMutationKind::Project,
            Self::Complete => OnboardingMutationKind::Complete,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileUpdateRequest<'a> {
    name: &'a str,
    email: &'a str,
    mutation_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterProjectRequest<'a> {
    path: &'a str,
    mutation_id: &'a str,
}

struct OnboardingMutationOutput {
    snapshot: DesktopBootstrap,
    provider_rows: Option<Vec<ProviderOnboardingRow>>,
}

struct OnboardingMutationError {
    error: UserError,
    snapshot: Option<DesktopBootstrap>,
}

#[derive(Serialize)]
struct ProviderVerificationRequest {
    level: ProviderVerificationLevel,
}

fn run_onboarding_mutation(
    options: &TransportOptions,
    mutation: OnboardingMutation,
    mutation_id: &str,
) -> std::result::Result<OnboardingMutationOutput, OnboardingMutationError> {
    let result = run_onboarding_mutation_inner(options, mutation, mutation_id);
    match result {
        Ok(output) => Ok(output),
        Err(error) => {
            let snapshot = if error.api.as_ref().is_some_and(|api| {
                api.status == 412 || (api.status == 409 && api.code.as_deref() == Some("conflict"))
            }) {
                onboarding_snapshot_read(options).ok()
            } else {
                None
            };
            Err(OnboardingMutationError { error, snapshot })
        }
    }
}

fn onboarding_snapshot_read(options: &TransportOptions) -> Result<DesktopBootstrap, UserError> {
    let environment = if options.environment.is_empty() {
        env::vars().collect()
    } else {
        options.environment.clone()
    };
    let paths = DaemonPaths::resolve(&environment, options.home_directory.as_deref())?;
    let token = SecretToken::read(&paths.token_path)?;
    let client = Client::builder()
        .unix_socket(paths.socket_path)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(transport_error)?;
    get_json(&client, &token, "/v0/bootstrap/desktop")
}

fn run_onboarding_mutation_inner(
    options: &TransportOptions,
    mutation: OnboardingMutation,
    mutation_id: &str,
) -> Result<OnboardingMutationOutput, UserError> {
    let environment = if options.environment.is_empty() {
        env::vars().collect()
    } else {
        options.environment.clone()
    };
    let paths = DaemonPaths::resolve(&environment, options.home_directory.as_deref())?;
    let token = SecretToken::read(&paths.token_path)?;
    let client = Client::builder()
        .unix_socket(paths.socket_path)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(transport_error)?;

    let provider_rows = match &mutation {
        OnboardingMutation::Profile {
            name,
            email,
            version,
        } => {
            checked_response(
                client
                    .patch("http://happy-agent/v0/profile")
                    .header(IF_MATCH, version)
                    .header(CONTENT_TYPE, "application/json")
                    .json(&ProfileUpdateRequest {
                        name,
                        email,
                        mutation_id,
                    })
                    .header(ACCEPT, "application/json")
                    .header(AUTHORIZATION, token.authorization())
                    .send()
                    .map_err(transport_error)?,
                &token,
            )?;
            None
        }
        OnboardingMutation::ProvidersScan => {
            let scan: ProviderScanResponse = checked_response(
                client
                    .post("http://happy-agent/v0/providers/scan")
                    .header(ACCEPT, "application/json")
                    .header(AUTHORIZATION, token.authorization())
                    .send()
                    .map_err(transport_error)?,
                &token,
            )?
            .capped_json()?;
            Some(provider_rows(&client, &token, &environment, scan))
        }
        OnboardingMutation::Project { path } => {
            let path = path
                .to_str()
                .ok_or_else(|| user_error("The selected project path is not valid UTF-8."))?;
            checked_response(
                client
                    .post("http://happy-agent/v0/projects")
                    .header(CONTENT_TYPE, "application/json")
                    .json(&RegisterProjectRequest { path, mutation_id })
                    .header(ACCEPT, "application/json")
                    .header(AUTHORIZATION, token.authorization())
                    .send()
                    .map_err(transport_error)?,
                &token,
            )?;
            None
        }
        OnboardingMutation::Complete => {
            complete_onboarding(&client, &token)?;
            None
        }
    };
    let snapshot = get_json(&client, &token, "/v0/bootstrap/desktop")?;
    Ok(OnboardingMutationOutput {
        snapshot,
        provider_rows,
    })
}

fn complete_onboarding(client: &Client, token: &SecretToken) -> Result<(), UserError> {
    let completed: OnboardingCompletedResponse = checked_response(
        client
            .post("http://happy-agent/v0/onboarding/complete")
            .header(ACCEPT, "application/json")
            .header(AUTHORIZATION, token.authorization())
            .send()
            .map_err(transport_error)?,
        token,
    )?
    .capped_json()?;
    if !completed.completed {
        return Err(user_error("Happy Agent did not complete onboarding."));
    }
    Ok(())
}

fn provider_rows(
    client: &Client,
    token: &SecretToken,
    environment: &BTreeMap<String, String>,
    scan: ProviderScanResponse,
) -> Vec<ProviderOnboardingRow> {
    OnboardingProviderId::ALL
        .into_iter()
        .map(|id| {
            let command_path = find_on_path(id.as_str(), environment);
            let authentication = command_path.as_ref().map(|_| {
                verify_provider_authentication(client, token, id)
                    .unwrap_or(ProviderAuthenticationState::Error)
            });
            let scan = scan
                .providers
                .iter()
                .find(|result| result.provider_id == id.as_str())
                .cloned();
            ProviderOnboardingRow {
                id,
                command_path,
                scan,
                authentication,
            }
        })
        .collect()
}

fn verify_provider_authentication(
    client: &Client,
    token: &SecretToken,
    id: OnboardingProviderId,
) -> Result<ProviderAuthenticationState, UserError> {
    let path = format!("/v0/providers/{}/verify", id.as_str());
    let response: ProviderVerificationResponse = checked_response(
        client
            .post(format!("http://happy-agent{path}"))
            .header(CONTENT_TYPE, "application/json")
            .json(&ProviderVerificationRequest {
                level: ProviderVerificationLevel::Authentication,
            })
            .header(ACCEPT, "application/json")
            .header(AUTHORIZATION, token.authorization())
            .send()
            .map_err(transport_error)?,
        token,
    )?
    .capped_json()?;
    Ok(
        if response.provider_id == id.as_str()
            && response.requested_level == ProviderVerificationLevel::Authentication
            && response.performed_level == ProviderVerificationLevel::Authentication
            && response.status == ProviderVerificationStatus::Passed
        {
            ProviderAuthenticationState::Valid
        } else {
            ProviderAuthenticationState::Invalid
        },
    )
}

fn find_on_path(command: &str, environment: &BTreeMap<String, String>) -> Option<PathBuf> {
    let path = environment.get("PATH")?;
    env::split_paths(path).find_map(|directory| {
        let candidate = directory.join(command);
        executable_file(&candidate).then_some(candidate)
    })
}

#[cfg(unix)]
fn executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn executable_file(path: &Path) -> bool {
    path.is_file()
}

fn stream_request(
    client: &Client,
    token: &SecretToken,
    cursor: &str,
) -> Result<Response, UserError> {
    let mut url = reqwest::Url::parse("http://happy-agent/v0/events/stream").expect("static URL");
    url.query_pairs_mut().append_pair("after", cursor);
    let response = client
        .get(url)
        .header(ACCEPT, "text/event-stream")
        .header(AUTHORIZATION, token.authorization())
        .header("last-event-id", cursor)
        .send()
        .map_err(transport_error)?;
    checked_response(response, token)
}
fn get_json<T: DeserializeOwned>(
    client: &Client,
    token: &SecretToken,
    path: &str,
) -> Result<T, UserError> {
    let url = format!("http://happy-agent{path}");
    checked_response(
        client
            .get(url)
            .timeout(Duration::from_secs(10))
            .header(ACCEPT, "application/json")
            .header(AUTHORIZATION, token.authorization())
            .send()
            .map_err(transport_error)?,
        token,
    )?
    .capped_json()
}
fn post_json<T: DeserializeOwned>(
    client: &Client,
    token: &SecretToken,
    path: &str,
    body: &impl Serialize,
) -> Result<T, UserError> {
    let url = format!("http://happy-agent{path}");
    checked_response(
        client
            .post(url)
            .timeout(Duration::from_secs(10))
            .header(ACCEPT, "application/json")
            .header(AUTHORIZATION, token.authorization())
            .json(body)
            .send()
            .map_err(transport_error)?,
        token,
    )?
    .capped_json()
}
trait CappedResponseJson {
    fn capped_json<T: DeserializeOwned>(self) -> Result<T, UserError>;
}

impl CappedResponseJson for Response {
    fn capped_json<T: DeserializeOwned>(self) -> Result<T, UserError> {
        let bytes = capped_response_body(self, MAX_DAEMON_RESPONSE_BYTES)?;
        serde_json::from_slice(&bytes).map_err(protocol_error)
    }
}

fn capped_response_body(mut response: Response, limit: u64) -> Result<Vec<u8>, UserError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err(daemon_response_too_large());
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(transport_error)?;
    if bytes.len() as u64 > limit {
        return Err(daemon_response_too_large());
    }
    Ok(bytes)
}

fn daemon_response_too_large() -> UserError {
    UserError {
        kind: UserErrorKind::Protocol,
        message: "Happy Agent returned data that exceeds the safe memory limit.".into(),
        api: None,
    }
}

fn checked_response(response: Response, token: &SecretToken) -> Result<Response, UserError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let mut body = capped_response_body(response, MAX_API_ERROR_BODY_BYTES)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .filter(serde_json::Value::is_object);
    if let Some(body) = body.as_mut() {
        redact_error_value(body, token);
        let mut nodes = MAX_API_ERROR_NODES;
        sanitize_error_value(body, &mut nodes);
    }
    let code = body
        .as_ref()
        .and_then(|value| value.get("code"))
        .and_then(serde_json::Value::as_str)
        .map(|value| bounded_utf8(value, MAX_API_ERROR_CODE_BYTES));
    let message = body
        .as_ref()
        .and_then(|value| value.get("error"))
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .map(|value| bounded_utf8(value, MAX_API_ERROR_STRING_BYTES))
        .unwrap_or_else(|| format!("Happy Agent returned HTTP {}.", status.as_u16()));
    Err(UserError {
        kind: UserErrorKind::Api,
        message: message.clone(),
        api: Some(ApiError {
            status: status.as_u16(),
            code,
            message,
            body,
        }),
    })
}

fn redact_error_value(value: &mut serde_json::Value, token: &SecretToken) {
    match value {
        serde_json::Value::String(text) => *text = token.redact(text),
        serde_json::Value::Array(values) => {
            for value in values {
                redact_error_value(value, token);
            }
        }
        serde_json::Value::Object(values) => {
            let mut redacted = serde_json::Map::new();
            for (key, mut value) in std::mem::take(values) {
                redact_error_value(&mut value, token);
                redacted.insert(token.redact(&key), value);
            }
            *values = redacted;
        }
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {}
    }
}

fn sanitize_error_value(value: &mut serde_json::Value, nodes: &mut usize) {
    if *nodes == 0 {
        *value = serde_json::Value::String("[omitted]".into());
        return;
    }
    *nodes -= 1;
    match value {
        serde_json::Value::String(text) => {
            *text = bounded_utf8(text, MAX_API_ERROR_STRING_BYTES);
        }
        serde_json::Value::Array(values) => {
            let mut retained = Vec::new();
            for mut value in std::mem::take(values) {
                if *nodes == 0 {
                    break;
                }
                sanitize_error_value(&mut value, nodes);
                retained.push(value);
            }
            *values = retained;
        }
        serde_json::Value::Object(values) => {
            values.retain(|_, value| {
                if *nodes == 0 {
                    return false;
                }
                sanitize_error_value(value, nodes);
                true
            });
        }
        _ => {}
    }
}

fn bounded_utf8(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_owned();
    }
    let mut end = limit;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

pub(super) fn daemon_http_client(socket_path: &Path) -> Result<Client, UserError> {
    Client::builder()
        .unix_socket(socket_path)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(transport_error)
}

pub(super) struct SecretToken(String);
impl SecretToken {
    pub(super) fn read(path: &Path) -> Result<Self, UserError> {
        let mut bytes = Vec::new();
        File::open(path)
            .and_then(|file| {
                file.take(MAX_SECRET_TOKEN_BYTES + 1)
                    .read_to_end(&mut bytes)
            })
            .map_err(|_| {
                unavailable_error("The Happy Agent authentication token is unavailable.")
            })?;
        if bytes.len() as u64 > MAX_SECRET_TOKEN_BYTES {
            return Err(unavailable_error(
                "The Happy Agent authentication token is invalid.",
            ));
        }
        let token = std::str::from_utf8(&bytes)
            .map_err(|_| unavailable_error("The Happy Agent authentication token is invalid."))?
            .trim();
        if token.is_empty() {
            Err(unavailable_error(
                "The Happy Agent authentication token is empty.",
            ))
        } else {
            Ok(Self(token.to_owned()))
        }
    }
    pub(super) fn authorization(&self) -> String {
        format!("Bearer {}", self.0)
    }

    pub(super) fn redact(&self, value: &str) -> String {
        value.replace(&self.0, "[redacted]")
    }
}

pub(super) struct DaemonPaths {
    pub(super) socket_path: PathBuf,
    pub(super) token_path: PathBuf,
}
impl DaemonPaths {
    pub(super) fn resolve(
        environment: &BTreeMap<String, String>,
        supplied_home: Option<&Path>,
    ) -> Result<Self, UserError> {
        let home = supplied_home
            .map(Path::to_path_buf)
            .or_else(|| environment.get("HOME").map(PathBuf::from))
            .ok_or_else(|| user_error("The home directory is unavailable."))?;
        let happy_home =
            happy_home_resolve(environment.get("HAPPY_HOME_DIR").map(String::as_str), &home);
        let agent = happy_home.join("agent");
        let socket_path = environment
            .get("HAPPY_AGENT_SERVER_SOCKET_PATH")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| agent.join("server.sock"));
        let token_path = environment
            .get("HAPPY_AGENT_SERVER_TOKEN_PATH")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| agent.join("token"));
        Ok(Self {
            socket_path,
            token_path,
        })
    }
}

struct SseFrame {
    event: Option<String>,
    data: String,
}
fn read_sse_frame(reader: &mut impl BufRead) -> Result<Option<SseFrame>, UserError> {
    let mut event = None;
    let mut data = String::new();
    let mut saw_line = false;
    let mut frame_bytes = 0usize;
    let mut lines = 0usize;
    loop {
        let mut bytes = Vec::new();
        let count = reader
            .take((MAX_SSE_LINE_BYTES + 1) as u64)
            .read_until(b'\n', &mut bytes)
            .map_err(stream_read_error)?;
        if count == 0 {
            return if saw_line && !data.is_empty() {
                Ok(Some(SseFrame { event, data }))
            } else {
                Ok(None)
            };
        }
        if count > MAX_SSE_LINE_BYTES {
            return Err(sse_limit_error());
        }
        frame_bytes = frame_bytes.saturating_add(count);
        lines += 1;
        if frame_bytes > MAX_SSE_FRAME_BYTES || lines > MAX_SSE_FRAME_LINES {
            return Err(sse_limit_error());
        }
        saw_line = true;
        let line = std::str::from_utf8(&bytes)
            .map_err(|_| protocol_error("event stream line is not UTF-8"))?
            .trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            return Ok(Some(SseFrame { event, data }));
        }
        if line.starts_with(':') {
            continue;
        }
        if let Some(value) = line.strip_prefix("event:") {
            let value = value.strip_prefix(' ').unwrap_or(value);
            if value.len() > MAX_SSE_EVENT_BYTES {
                return Err(sse_limit_error());
            }
            event = Some(value.to_owned());
        }
        if let Some(value) = line.strip_prefix("data:") {
            let value = value.strip_prefix(' ').unwrap_or(value);
            let added = value.len() + usize::from(!data.is_empty());
            if data.len().saturating_add(added) > MAX_SSE_FRAME_BYTES {
                return Err(sse_limit_error());
            }
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value);
        }
    }
}

fn sse_limit_error() -> UserError {
    UserError {
        kind: UserErrorKind::Protocol,
        message: "Happy Agent returned an event stream frame that exceeds the safe memory limit."
            .into(),
        api: None,
    }
}

fn send(sender: &Sender<WorkerEvent>, event: WorkerEvent) {
    let _ = sender.send_blocking(event);
}
fn user_error(message: impl Into<String>) -> UserError {
    UserError {
        kind: UserErrorKind::Setup,
        message: message.into(),
        api: None,
    }
}
fn unavailable_error(message: impl Into<String>) -> UserError {
    UserError {
        kind: UserErrorKind::Unavailable,
        message: message.into(),
        api: None,
    }
}
fn transport_error(error: impl fmt::Display) -> UserError {
    let _ = error;
    unavailable_error("Could not reach the Happy Agent daemon.")
}
fn stream_read_error(error: std::io::Error) -> UserError {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        UserError {
            kind: UserErrorKind::StreamIdle,
            message: "Refreshing the Happy Agent event stream.".into(),
            api: None,
        }
    } else {
        transport_error(error)
    }
}

fn daemon_version_at_least(value: &str, minimum: (u64, u64, u64)) -> bool {
    let Some(core) = value.split(['-', '+']).next() else {
        return false;
    };
    let mut parts = core.split('.');
    let parsed = (
        parts.next().and_then(|part| part.parse::<u64>().ok()),
        parts.next().and_then(|part| part.parse::<u64>().ok()),
        parts.next().and_then(|part| part.parse::<u64>().ok()),
    );
    parts.next().is_none()
        && parsed
            .0
            .zip(parsed.1)
            .zip(parsed.2)
            .is_some_and(|((major, minor), patch)| (major, minor, patch) >= minimum)
}

fn protocol_error(error: impl fmt::Display) -> UserError {
    if std::env::var_os("HAPPY_GPUI_TRACE_CONNECTIVITY").is_some() {
        eprintln!("connectivity protocol detail: {error}");
    }
    UserError {
        kind: UserErrorKind::Protocol,
        message: "Happy Agent returned data outside protocol v23.".into(),
        api: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Cursor, os::unix::fs::PermissionsExt};

    #[test]
    fn daemon_version_comparison_requires_three_numeric_components() {
        assert!(daemon_version_at_least("0.4.24", (0, 4, 24)));
        assert!(daemon_version_at_least("0.4.27+build.1", (0, 4, 24)));
        assert!(daemon_version_at_least("1.0.0-beta.1", (0, 4, 24)));
        assert!(!daemon_version_at_least("0.4.23", (0, 4, 24)));
        assert!(!daemon_version_at_least("0.4", (0, 4, 24)));
        assert!(!daemon_version_at_least("v0.4.24", (0, 4, 24)));
        assert!(!daemon_version_at_least("0.4.24.1", (0, 4, 24)));
    }

    #[test]
    fn sse_parser_preserves_event_names_multiline_data_and_eof_frames() {
        let mut stream = Cursor::new(
            b": heartbeat\r\nevent: hello\r\ndata: {\"cursor\":\"1\",\r\ndata: \"gap\":false}\r\n\r\n",
        );
        let frame = read_sse_frame(&mut stream).unwrap().unwrap();
        assert_eq!(frame.event.as_deref(), Some("hello"));
        assert_eq!(frame.data, "{\"cursor\":\"1\",\n\"gap\":false}");
        assert!(read_sse_frame(&mut stream).unwrap().is_none());

        let mut eof = Cursor::new(b"event: update\ndata: tail");
        let frame = read_sse_frame(&mut eof).unwrap().unwrap();
        assert_eq!(frame.event.as_deref(), Some("update"));
        assert_eq!(frame.data, "tail");
    }

    #[test]
    fn authority_gate_serializes_snapshot_and_mutation_publication() {
        use std::sync::mpsc;

        let gate = Arc::new(Mutex::new(()));
        let order = Arc::new(Mutex::new(Vec::new()));
        let (acquired_tx, acquired_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();

        let first_gate = gate.clone();
        let first_order = order.clone();
        let first = thread::spawn(move || {
            let authority = authority_enter(&first_gate);
            acquired_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            first_order.lock().unwrap().push("reconcile");
            drop(authority);
        });
        acquired_rx.recv().unwrap();

        let second_gate = gate.clone();
        let second_order = order.clone();
        let second = thread::spawn(move || {
            let _authority = authority_enter(&second_gate);
            second_order.lock().unwrap().push("mutation");
        });
        release_tx.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();
        assert_eq!(order.lock().unwrap().as_slice(), ["reconcile", "mutation"]);
    }

    #[test]
    fn resumed_stream_retains_cursor_and_rejects_malformed_ordering() {
        let mut cursor = "cursor-4".to_owned();
        let mut received = false;
        let resumed = EventStreamHello {
            cursor: "cursor-9".into(),
            gap: false,
            resumed: true,
            connected_at: 1,
            daemon_id: None,
            daemon_started_at: None,
            draining: None,
        };
        assert!(!accept_stream_hello(&mut cursor, &mut received, &resumed).unwrap());
        assert_eq!(cursor, "cursor-4");
        assert!(!accept_stream_event_cursor(&mut cursor, received, "cursor-4").unwrap());
        assert!(accept_stream_event_cursor(&mut cursor, received, "cursor-5").unwrap());
        assert_eq!(cursor, "cursor-5");
        assert!(accept_stream_hello(&mut cursor, &mut received, &resumed).is_err());

        let mut missing_hello_cursor = "cursor-1".to_owned();
        assert!(accept_stream_event_cursor(&mut missing_hello_cursor, false, "cursor-2").is_err());
        let mut lost_cursor = "cursor-5".to_owned();
        let mut lost_received = false;
        let lost = EventStreamHello {
            cursor: "cursor-10".into(),
            gap: true,
            resumed: false,
            ..resumed
        };
        assert!(accept_stream_hello(&mut lost_cursor, &mut lost_received, &lost).unwrap());
        assert_eq!(lost_cursor, "cursor-10");
    }

    #[test]
    fn event_hints_coalesce_into_typed_authoritative_resource_families() {
        let mut plan = ReconcilePlan::default();
        plan.include(HappyAgentEventType::ProfileUpdated);
        plan.include(HappyAgentEventType::ProjectCreated);
        plan.include(HappyAgentEventType::MessageDelta);
        assert_eq!(
            plan,
            ReconcilePlan {
                config: false,
                onboarding: true,
                profile: true,
                projects: true,
                workspaces: true,
                ..ReconcilePlan::default()
            }
        );
        for event_type in [
            HappyAgentEventType::ProcessStarted,
            HappyAgentEventType::ProcessUpdated,
            HappyAgentEventType::ProcessExited,
            HappyAgentEventType::QuestionCreated,
            HappyAgentEventType::QuestionUpdated,
            HappyAgentEventType::RunStarted,
            HappyAgentEventType::RunBoundary,
            HappyAgentEventType::RunFinished,
        ] {
            let mut embedded_agent_facts = ReconcilePlan::default();
            embedded_agent_facts.include(event_type);
            assert!(embedded_agent_facts.projects);
            assert!(embedded_agent_facts.workspaces);
            assert!(embedded_agent_facts.bots);
        }

        let mut unrelated = ReconcilePlan::default();
        unrelated.include(HappyAgentEventType::MessageUpdated);
        assert!(unrelated.is_empty());
    }

    #[test]
    fn owned_mutations_serialize_protocol_correlation_ids() {
        let profile = serde_json::to_value(ProfileUpdateRequest {
            name: "Happy User",
            email: "happy@example.com",
            mutation_id: "happy-gpui-1-7",
        })
        .unwrap();
        let project = serde_json::to_value(RegisterProjectRequest {
            path: "/tmp/project",
            mutation_id: "happy-gpui-1-8",
        })
        .unwrap();
        assert_eq!(profile["mutationId"], "happy-gpui-1-7");
        assert_eq!(project["mutationId"], "happy-gpui-1-8");
    }

    #[test]
    fn buffered_sse_frames_form_one_authoritative_reconciliation_batch() {
        let stream = Cursor::new(
            b"event: update\ndata: {\"cursor\":\"1\"}\n\nevent: update\ndata: {\"cursor\":\"2\"}\n\n",
        );
        let mut reader = BufReader::with_capacity(1024, stream);
        assert_eq!(
            read_sse_frame(&mut reader)
                .unwrap()
                .unwrap()
                .event
                .as_deref(),
            Some("update")
        );
        assert!(
            !reader.buffer().is_empty(),
            "the second already-readable frame stays buffered"
        );
        assert_eq!(
            read_sse_frame(&mut reader)
                .unwrap()
                .unwrap()
                .event
                .as_deref(),
            Some("update")
        );
        assert!(
            reader.buffer().is_empty(),
            "the batch reconciles after buffered frames drain"
        );
    }

    #[test]
    fn managed_route_requires_two_trimmed_nonempty_values() {
        assert!(managed_route(
            Some(" /tmp/server.sock "),
            Some(" /tmp/token ")
        ));
        assert!(!managed_route(Some(" "), Some("/tmp/token")));
        assert!(!managed_route(Some("/tmp/server.sock"), Some("\n\t")));
        assert!(!managed_route(Some("/tmp/server.sock"), None));
    }

    #[test]
    fn reconnect_policy_caps_backoff_and_resets_only_after_stability() {
        let base = Duration::from_millis(250);
        let maximum = Duration::from_secs(5);
        assert_eq!(
            reconnect_backoff(base, maximum, 1),
            Duration::from_millis(250)
        );
        assert_eq!(
            reconnect_backoff(base, maximum, 2),
            Duration::from_millis(500)
        );
        assert_eq!(reconnect_backoff(base, maximum, 5), Duration::from_secs(4));
        assert_eq!(reconnect_backoff(base, maximum, 6), maximum);
        assert_eq!(reconnect_backoff(base, maximum, 100), maximum);
        assert!(!stream_is_stable(Some(Duration::from_secs(29)), false));
        assert!(stream_is_stable(Some(Duration::from_secs(30)), false));
        assert!(stream_is_stable(None, true));
    }

    #[test]
    fn login_shell_resolution_preserves_an_exact_managed_route_pair() {
        let directory = env::temp_dir().join(format!(
            "happy-gpui-resolved-environment-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir(&directory).unwrap();
        let shell = directory.join("fake-login-shell");
        fs::write(
            &shell,
            b"#!/bin/sh\nprintf '__HAPPY_ENV__\\000PATH=/from-shell\\000HOME=/shell-home\\000'\n",
        )
        .unwrap();
        fs::set_permissions(&shell, fs::Permissions::from_mode(0o700)).unwrap();
        let base = BTreeMap::from([
            ("HOME".into(), "/launch-home".into()),
            ("PATH".into(), "/launch-bin".into()),
            ("SHELL".into(), shell.to_string_lossy().into_owned()),
            (
                "HAPPY_AGENT_SERVER_SOCKET_PATH".into(),
                "/managed/server.sock".into(),
            ),
            (
                "HAPPY_AGENT_SERVER_TOKEN_PATH".into(),
                "/managed/token".into(),
            ),
        ]);
        let resolved = resolve_login_environment(&base);
        assert_eq!(
            resolved.get("PATH").map(String::as_str),
            Some("/from-shell")
        );
        assert_eq!(
            resolved
                .get("HAPPY_AGENT_SERVER_SOCKET_PATH")
                .map(String::as_str),
            Some("/managed/server.sock")
        );
        assert_eq!(
            resolved
                .get("HAPPY_AGENT_SERVER_TOKEN_PATH")
                .map(String::as_str),
            Some("/managed/token")
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn provider_commands_use_only_the_resolved_path_and_require_executable_files() {
        let directory =
            env::temp_dir().join(format!("happy-gpui-provider-path-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir(&directory).unwrap();
        let claude = directory.join("claude");
        let codex = directory.join("codex");
        fs::write(&claude, b"#!/bin/sh\n").unwrap();
        fs::write(&codex, b"#!/bin/sh\n").unwrap();
        fs::set_permissions(&claude, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&codex, fs::Permissions::from_mode(0o600)).unwrap();
        let environment = BTreeMap::from([(
            "PATH".into(),
            env::join_paths([directory.as_path()])
                .unwrap()
                .to_string_lossy()
                .into_owned(),
        )]);
        assert_eq!(find_on_path("claude", &environment), Some(claude));
        assert_eq!(find_on_path("codex", &environment), None);
        assert_eq!(find_on_path("grok", &environment), None);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn daemon_paths_ignore_blank_overrides() {
        let home = Path::new("/Users/example");
        let environment = BTreeMap::from([
            ("HAPPY_AGENT_SERVER_SOCKET_PATH".into(), "  ".into()),
            ("HAPPY_AGENT_SERVER_TOKEN_PATH".into(), "\t".into()),
        ]);
        let paths = DaemonPaths::resolve(&environment, Some(home)).unwrap();
        assert_eq!(paths.socket_path, home.join(".happy/agent/server.sock"));
        assert_eq!(paths.token_path, home.join(".happy/agent/token"));
    }
}
