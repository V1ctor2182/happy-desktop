//! Focused-agent chat HTTP transport.
//!
//! One blocking Unix-socket worker owns every chat read and write. Realtime
//! events mark the focused chat dirty; this worker always reads the durable
//! agent routes before it publishes replacement state.

use std::{
    collections::{BTreeMap, VecDeque},
    env,
    io::Read,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use async_channel::{Receiver, Sender, TryRecvError, TrySendError};
use reqwest::{
    Method, Url,
    blocking::{Client, Response},
    header::{ACCEPT, AUTHORIZATION},
};
use serde::{Serialize, de::DeserializeOwned};

use super::{
    chat_protocol::{
        AbortAgentRequest, AgentAbortResponse, AgentBootstrapResponse, AgentCompactResponse,
        AgentDraftResponse, AgentResponse, AnswerQuestionRequest, ArchiveAgentRequest,
        ArchiveAgentResponse, BackgroundProcessResponse, CompactAgentRequest, CreateAgentRequest,
        CreateAgentResponse, InvokeSlashCommandRequest, InvokeSlashCommandResponse,
        MarkAgentReadRequest, MarkAgentReadResponse, MessageHistoryQuery, MessageHistoryResponse,
        PendingQuestionResponse, Question, QuestionResponse, ReorderAgentRequest,
        ReorderAgentResponse, SaveAgentDraftRequest, SendMessageRequest, SendMessageResponse,
        UnarchiveAgentRequest, UnarchiveAgentResponse, UserMessage, UserRole,
    },
    transport::{
        ApiError, DaemonPaths, SecretToken, TransportOptions, UserError, UserErrorKind,
        daemon_http_client,
    },
};

const LATEST_MESSAGE_LIMIT: u64 = 100;
const REFRESH_QUIET: Duration = Duration::from_millis(20);
const SEND_ATTEMPTS: usize = 3;
const INITIAL_SEND_RETRY: Duration = Duration::from_millis(250);
const CHAT_COMMAND_CAPACITY: usize = 8;
const CHAT_EVENT_CAPACITY: usize = 4;
const MAX_CHAT_RESPONSE_BYTES: u64 = 96 * 1024 * 1024;
const MAX_API_ERROR_BODY_BYTES: u64 = 1024 * 1024;
const MAX_API_ERROR_NODES: usize = 4096;
const MAX_API_ERROR_STRING_BYTES: usize = 4096;
const MAX_API_ERROR_CODE_BYTES: usize = 256;

/// Local request correlation. It is unrelated to protocol `mutationId`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ChatRequestId(pub u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatOperation {
    Focus,
    Unfocus,
    Refresh,
    LoadOlder,
    CreateAgent,
    ArchiveAgent,
    UnarchiveAgent,
    MarkAgentRead,
    ReorderAgent,
    SaveDraft,
    SendMessage,
    AbortAgent,
    CompactAgent,
    AnswerQuestion,
    InvokeSlashCommand,
    StopProcess,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FocusedAgentSnapshot {
    pub bootstrap: AgentBootstrapResponse,
    pub history: MessageHistoryResponse,
    /// Read only when `bootstrap.agent.pending_question_id` is present.
    pub pending_question: Option<Question>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateAgentAdmission {
    pub request_id: ChatRequestId,
    pub agent_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SendMessageAdmission {
    pub request_id: ChatRequestId,
    pub message_id: String,
}

/// Authoritative results from the chat worker. A `Failed` event never replaces
/// any last-good snapshot held by product state.
#[derive(Clone, Debug, PartialEq)]
pub enum ChatEvent {
    Focused {
        request_id: ChatRequestId,
        agent_id: String,
        snapshot: FocusedAgentSnapshot,
    },
    Unfocused {
        request_id: ChatRequestId,
        agent_id: Option<String>,
    },
    Refreshed {
        request_id: ChatRequestId,
        agent_id: String,
        snapshot: FocusedAgentSnapshot,
    },
    OlderLoaded {
        request_id: ChatRequestId,
        agent_id: String,
        before_run_id: String,
        page: MessageHistoryResponse,
    },
    AgentCreated {
        request_id: ChatRequestId,
        response: CreateAgentResponse,
    },
    AgentArchived {
        request_id: ChatRequestId,
        agent_id: String,
        response: ArchiveAgentResponse,
    },
    AgentUnarchived {
        request_id: ChatRequestId,
        agent_id: String,
        response: UnarchiveAgentResponse,
    },
    AgentMarkedRead {
        request_id: ChatRequestId,
        agent_id: String,
        response: MarkAgentReadResponse,
    },
    AgentReordered {
        request_id: ChatRequestId,
        agent_id: String,
        response: ReorderAgentResponse,
    },
    DraftSaved {
        request_id: ChatRequestId,
        agent_id: String,
        response: AgentDraftResponse,
    },
    MessageSent {
        request_id: ChatRequestId,
        agent_id: String,
        response: SendMessageResponse,
    },
    AgentAborted {
        request_id: ChatRequestId,
        agent_id: String,
        response: AgentAbortResponse,
    },
    AgentCompacted {
        request_id: ChatRequestId,
        agent_id: String,
        response: AgentCompactResponse,
    },
    QuestionAnswered {
        request_id: ChatRequestId,
        agent_id: String,
        response: QuestionResponse,
    },
    SlashCommandInvoked {
        request_id: ChatRequestId,
        agent_id: String,
        response: InvokeSlashCommandResponse,
    },
    ProcessStopped {
        request_id: ChatRequestId,
        agent_id: String,
        response: BackgroundProcessResponse,
    },
    /// Coalesced delivery hints whose provenance can be retired without
    /// publishing the same authoritative snapshot more than once.
    RequestsRetired {
        request_ids: Vec<ChatRequestId>,
    },
    Failed {
        request_id: ChatRequestId,
        operation: ChatOperation,
        agent_id: Option<String>,
        error: UserError,
    },
    Stopped,
}

#[derive(Debug)]
enum ChatCommand {
    Focus {
        request_id: ChatRequestId,
        agent_id: String,
    },
    Unfocus {
        request_id: ChatRequestId,
    },
    Refresh {
        request_id: ChatRequestId,
        agent_id: String,
    },
    LoadOlder {
        request_id: ChatRequestId,
        agent_id: String,
        before_run_id: String,
    },
    CreateAgent {
        request_id: ChatRequestId,
        request: CreateAgentRequest,
    },
    ArchiveAgent {
        request_id: ChatRequestId,
        agent_id: String,
        request: ArchiveAgentRequest,
    },
    UnarchiveAgent {
        request_id: ChatRequestId,
        agent_id: String,
        request: UnarchiveAgentRequest,
    },
    MarkAgentRead {
        request_id: ChatRequestId,
        agent_id: String,
        request: MarkAgentReadRequest,
    },
    ReorderAgent {
        request_id: ChatRequestId,
        agent_id: String,
        request: ReorderAgentRequest,
    },
    SaveDraft {
        request_id: ChatRequestId,
        agent_id: String,
        request: SaveAgentDraftRequest,
    },
    SendMessage {
        request_id: ChatRequestId,
        agent_id: String,
        request: SendMessageRequest,
    },
    AbortAgent {
        request_id: ChatRequestId,
        agent_id: String,
        request: AbortAgentRequest,
    },
    CompactAgent {
        request_id: ChatRequestId,
        agent_id: String,
        request: CompactAgentRequest,
    },
    AnswerQuestion {
        request_id: ChatRequestId,
        agent_id: String,
        question_id: String,
        request: AnswerQuestionRequest,
    },
    InvokeSlashCommand {
        request_id: ChatRequestId,
        agent_id: String,
        name: String,
        request: InvokeSlashCommandRequest,
    },
    StopProcess {
        request_id: ChatRequestId,
        agent_id: String,
        process_id: String,
    },
    /// A bounded wake-up only. The authoritative dirty state lives outside the
    /// command queue, so saturation cannot lose a realtime delivery hint.
    WakeRefresh {
        request_id: ChatRequestId,
    },
    Shutdown,
}

#[derive(Debug)]
struct PendingHintRefresh {
    request_id: ChatRequestId,
    agent_id: String,
    wake_queued: bool,
}

pub struct ChatTransport {
    commands: Sender<ChatCommand>,
    events: Receiver<ChatEvent>,
    next_request_id: AtomicU64,
    hint_refresh: Arc<Mutex<Option<PendingHintRefresh>>>,
}

impl ChatTransport {
    pub fn receiver(&self) -> Receiver<ChatEvent> {
        self.events.clone()
    }

    fn next_id(&self) -> ChatRequestId {
        ChatRequestId(self.next_request_id.fetch_add(1, Ordering::Relaxed))
    }

    fn admit(&self, command: ChatCommand) -> Result<(), UserError> {
        match self.commands.try_send(command) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err(UserError {
                kind: UserErrorKind::Unavailable,
                message: "Happy Agent chat is busy. Try again shortly.".into(),
                api: None,
            }),
            Err(TrySendError::Closed(_)) => Err(stopped_error()),
        }
    }

    pub fn focus(&self, agent_id: String) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::Focus {
            request_id,
            agent_id,
        })?;
        Ok(request_id)
    }

    pub fn unfocus(&self) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::Unfocus { request_id })?;
        Ok(request_id)
    }

    pub fn refresh(&self, agent_id: String) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::Refresh {
            request_id,
            agent_id,
        })?;
        Ok(request_id)
    }

    /// Marks the focused conversation dirty without depending on command-queue
    /// admission. Repeated hints share one request until the worker takes the
    /// dirty state, and the bounded wake-up may be dropped only when queued
    /// commands already guarantee that the worker will check it again.
    pub fn refresh_hint(&self, agent_id: String) -> Result<ChatRequestId, UserError> {
        if self.commands.is_closed() {
            return Err(stopped_error());
        }
        let mut pending = self.hint_refresh.lock().unwrap();
        if let Some(refresh) = pending.as_ref()
            && refresh.agent_id == agent_id
        {
            return Ok(refresh.request_id);
        }
        let request_id = self.next_id();
        *pending = Some(PendingHintRefresh {
            request_id,
            agent_id,
            wake_queued: false,
        });
        match self
            .commands
            .try_send(ChatCommand::WakeRefresh { request_id })
        {
            Ok(()) => {
                pending.as_mut().unwrap().wake_queued = true;
                Ok(request_id)
            }
            Err(TrySendError::Full(_)) => Ok(request_id),
            Err(TrySendError::Closed(_)) => Err(stopped_error()),
        }
    }

    pub fn load_older(
        &self,
        agent_id: String,
        before_run_id: String,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::LoadOlder {
            request_id,
            agent_id,
            before_run_id,
        })?;
        Ok(request_id)
    }

    pub fn create_agent(
        &self,
        mut request: CreateAgentRequest,
    ) -> Result<CreateAgentAdmission, UserError> {
        let request_id = self.next_id();
        let agent_id = request.id.get_or_insert_with(cuid2::create_id).clone();
        self.admit(ChatCommand::CreateAgent {
            request_id,
            request,
        })?;
        Ok(CreateAgentAdmission {
            request_id,
            agent_id,
        })
    }

    pub fn archive_agent(
        &self,
        agent_id: String,
        request: ArchiveAgentRequest,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::ArchiveAgent {
            request_id,
            agent_id,
            request,
        })?;
        Ok(request_id)
    }
    pub fn unarchive_agent(
        &self,
        agent_id: String,
        request: UnarchiveAgentRequest,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::UnarchiveAgent {
            request_id,
            agent_id,
            request,
        })?;
        Ok(request_id)
    }
    pub fn mark_agent_read(
        &self,
        agent_id: String,
        request: MarkAgentReadRequest,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::MarkAgentRead {
            request_id,
            agent_id,
            request,
        })?;
        Ok(request_id)
    }
    pub fn reorder_agent(
        &self,
        agent_id: String,
        request: ReorderAgentRequest,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::ReorderAgent {
            request_id,
            agent_id,
            request,
        })?;
        Ok(request_id)
    }
    pub fn save_draft(
        &self,
        agent_id: String,
        request: SaveAgentDraftRequest,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::SaveDraft {
            request_id,
            agent_id,
            request,
        })?;
        Ok(request_id)
    }
    pub fn send_message(
        &self,
        agent_id: String,
        mut request: SendMessageRequest,
    ) -> Result<SendMessageAdmission, UserError> {
        let request_id = self.next_id();
        let message_id = request.id.get_or_insert_with(cuid2::create_id).clone();
        self.admit(ChatCommand::SendMessage {
            request_id,
            agent_id,
            request,
        })?;
        Ok(SendMessageAdmission {
            request_id,
            message_id,
        })
    }
    pub fn abort_agent(
        &self,
        agent_id: String,
        request: AbortAgentRequest,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::AbortAgent {
            request_id,
            agent_id,
            request,
        })?;
        Ok(request_id)
    }
    pub fn compact_agent(
        &self,
        agent_id: String,
        request: CompactAgentRequest,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::CompactAgent {
            request_id,
            agent_id,
            request,
        })?;
        Ok(request_id)
    }
    pub fn answer_question(
        &self,
        agent_id: String,
        question_id: String,
        request: AnswerQuestionRequest,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::AnswerQuestion {
            request_id,
            agent_id,
            question_id,
            request,
        })?;
        Ok(request_id)
    }
    pub fn invoke_slash_command(
        &self,
        agent_id: String,
        name: String,
        request: InvokeSlashCommandRequest,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::InvokeSlashCommand {
            request_id,
            agent_id,
            name,
            request,
        })?;
        Ok(request_id)
    }
    pub fn stop_process(
        &self,
        agent_id: String,
        process_id: String,
    ) -> Result<ChatRequestId, UserError> {
        let request_id = self.next_id();
        self.admit(ChatCommand::StopProcess {
            request_id,
            agent_id,
            process_id,
        })?;
        Ok(request_id)
    }
}

impl Drop for ChatTransport {
    fn drop(&mut self) {
        let _ = self.commands.try_send(ChatCommand::Shutdown);
    }
}

/// Starts an independent blocking Unix-socket worker for focused chat work.
pub fn start_chat_transport(options: TransportOptions) -> ChatTransport {
    let (command_sender, command_receiver) = async_channel::bounded(CHAT_COMMAND_CAPACITY);
    let (event_sender, event_receiver) = async_channel::bounded(CHAT_EVENT_CAPACITY);
    let hint_refresh = Arc::new(Mutex::new(None));
    let worker_hint_refresh = hint_refresh.clone();
    let worker_command_sender = command_sender.clone();
    thread::Builder::new()
        .name("happy-agent-chat".into())
        .spawn(move || {
            chat_worker(
                options,
                command_receiver,
                worker_command_sender,
                event_sender,
                worker_hint_refresh,
            )
        })
        .expect("chat transport worker should spawn");
    ChatTransport {
        commands: command_sender,
        events: event_receiver,
        next_request_id: AtomicU64::new(1),
        hint_refresh,
    }
}

fn chat_worker(
    options: TransportOptions,
    commands: Receiver<ChatCommand>,
    command_sender: Sender<ChatCommand>,
    events: Sender<ChatEvent>,
    hint_refresh: Arc<Mutex<Option<PendingHintRefresh>>>,
) {
    let environment: BTreeMap<String, String> = if options.environment.is_empty() {
        env::vars().collect()
    } else {
        options.environment
    };
    let paths = match DaemonPaths::resolve(&environment, options.home_directory.as_deref()) {
        Ok(paths) => paths,
        Err(error) => {
            send_event(
                &events,
                ChatEvent::Failed {
                    request_id: ChatRequestId(0),
                    operation: ChatOperation::Focus,
                    agent_id: None,
                    error,
                },
            );
            send_event(&events, ChatEvent::Stopped);
            return;
        }
    };
    let client = match daemon_http_client(&paths.socket_path) {
        Ok(client) => client,
        Err(error) => {
            send_event(
                &events,
                ChatEvent::Failed {
                    request_id: ChatRequestId(0),
                    operation: ChatOperation::Focus,
                    agent_id: None,
                    error,
                },
            );
            send_event(&events, ChatEvent::Stopped);
            return;
        }
    };
    let mut focused_agent_id = None;
    let mut pending = VecDeque::new();
    loop {
        let command = match pending.pop_front() {
            Some(command) => command,
            None => match commands.recv_blocking() {
                Ok(command) => command,
                Err(_) => break,
            },
        };
        if let ChatCommand::WakeRefresh { request_id } = command {
            let current = {
                let mut pending_refresh = hint_refresh.lock().unwrap();
                match pending_refresh.as_mut() {
                    Some(refresh) if refresh.request_id == request_id => {
                        refresh.wake_queued = false;
                        true
                    }
                    _ => false,
                }
            };
            if current {
                thread::sleep(REFRESH_QUIET);
                let refresh = {
                    let mut pending_refresh = hint_refresh.lock().unwrap();
                    match pending_refresh.as_ref() {
                        Some(refresh) if refresh.request_id == request_id => pending_refresh.take(),
                        _ => None,
                    }
                };
                if let Some(refresh) = refresh {
                    handle_refresh_batch(
                        vec![refresh.request_id],
                        refresh.agent_id,
                        &client,
                        &paths,
                        &events,
                        focused_agent_id.as_deref(),
                    );
                }
            }
            ensure_hint_wake(&command_sender, &hint_refresh);
            continue;
        }
        if matches!(command, ChatCommand::Shutdown) {
            break;
        }
        if matches!(command, ChatCommand::Refresh { .. }) {
            thread::sleep(REFRESH_QUIET);
            let mut refreshes = vec![command];
            loop {
                match commands.try_recv() {
                    Ok(next @ ChatCommand::Refresh { .. }) => refreshes.push(next),
                    Ok(next) => {
                        pending.push_back(next);
                        break;
                    }
                    Err(TryRecvError::Empty | TryRecvError::Closed) => break,
                }
            }
            let mut batches: BTreeMap<String, Vec<ChatRequestId>> = BTreeMap::new();
            for refresh in refreshes {
                if let ChatCommand::Refresh {
                    request_id,
                    agent_id,
                } = refresh
                {
                    batches.entry(agent_id).or_default().push(request_id);
                }
            }
            for (agent_id, request_ids) in batches {
                handle_refresh_batch(
                    request_ids,
                    agent_id,
                    &client,
                    &paths,
                    &events,
                    focused_agent_id.as_deref(),
                );
            }
            ensure_hint_wake(&command_sender, &hint_refresh);
            continue;
        }
        handle_command(command, &client, &paths, &events, &mut focused_agent_id);
        ensure_hint_wake(&command_sender, &hint_refresh);
    }
    send_event(&events, ChatEvent::Stopped);
}

fn ensure_hint_wake(
    commands: &Sender<ChatCommand>,
    hint_refresh: &Mutex<Option<PendingHintRefresh>>,
) {
    let mut pending = hint_refresh.lock().unwrap();
    let Some(refresh) = pending.as_mut() else {
        return;
    };
    if refresh.wake_queued {
        return;
    }
    if commands
        .try_send(ChatCommand::WakeRefresh {
            request_id: refresh.request_id,
        })
        .is_ok()
    {
        refresh.wake_queued = true;
    }
}

fn handle_refresh_batch(
    request_ids: Vec<ChatRequestId>,
    agent_id: String,
    client: &Client,
    paths: &DaemonPaths,
    events: &Sender<ChatEvent>,
    focused_agent_id: Option<&str>,
) {
    let result = if focused_agent_id != Some(agent_id.as_str()) {
        Err(not_focused_error())
    } else {
        SecretToken::read(&paths.token_path)
            .and_then(|token| read_focused(client, &token, &agent_id))
    };
    // One authoritative read is one publication. Intermediate refresh request
    // IDs are delivery nudges, not mutation acknowledgements, so publishing the
    // same large snapshot once per coalesced hint would only multiply UI work.
    let Some(request_id) = request_ids.last().copied() else {
        return;
    };
    if request_ids.len() > 1 {
        send_event(
            events,
            ChatEvent::RequestsRetired {
                request_ids: request_ids[..request_ids.len() - 1].to_vec(),
            },
        );
    }
    match result {
        Ok(snapshot) => send_event(
            events,
            ChatEvent::Refreshed {
                request_id,
                agent_id,
                snapshot,
            },
        ),
        Err(error) => failed(
            events,
            request_id,
            ChatOperation::Refresh,
            Some(agent_id),
            error,
        ),
    }
}

fn handle_command(
    command: ChatCommand,
    client: &Client,
    paths: &DaemonPaths,
    events: &Sender<ChatEvent>,
    focused_agent_id: &mut Option<String>,
) {
    if matches!(&command, ChatCommand::WakeRefresh { .. }) {
        return;
    }
    if let ChatCommand::Unfocus { request_id } = &command {
        let request_id = *request_id;
        let agent_id = focused_agent_id.take();
        send_event(
            events,
            ChatEvent::Unfocused {
                request_id,
                agent_id,
            },
        );
        return;
    }
    if let ChatCommand::Focus { agent_id, .. } = &command {
        *focused_agent_id = Some(agent_id.clone());
    }
    let token = match SecretToken::read(&paths.token_path) {
        Ok(token) => token,
        Err(error) => {
            let (request_id, operation, agent_id) = command_identity(&command);
            send_event(
                events,
                ChatEvent::Failed {
                    request_id,
                    operation,
                    agent_id,
                    error,
                },
            );
            return;
        }
    };
    match command {
        ChatCommand::Focus {
            request_id,
            agent_id,
        } => match read_focused(client, &token, &agent_id) {
            Ok(snapshot) => send_event(
                events,
                ChatEvent::Focused {
                    request_id,
                    agent_id,
                    snapshot,
                },
            ),
            Err(error) => failed(
                events,
                request_id,
                ChatOperation::Focus,
                Some(agent_id),
                error,
            ),
        },
        ChatCommand::Unfocus { request_id } => {
            let agent_id = focused_agent_id.take();
            send_event(
                events,
                ChatEvent::Unfocused {
                    request_id,
                    agent_id,
                },
            );
        }
        ChatCommand::Refresh {
            request_id,
            agent_id,
        } => {
            if focused_agent_id.as_deref() != Some(agent_id.as_str()) {
                failed(
                    events,
                    request_id,
                    ChatOperation::Refresh,
                    Some(agent_id),
                    not_focused_error(),
                );
            } else {
                match read_focused(client, &token, &agent_id) {
                    Ok(snapshot) => send_event(
                        events,
                        ChatEvent::Refreshed {
                            request_id,
                            agent_id,
                            snapshot,
                        },
                    ),
                    Err(error) => failed(
                        events,
                        request_id,
                        ChatOperation::Refresh,
                        Some(agent_id),
                        error,
                    ),
                }
            }
        }
        ChatCommand::LoadOlder {
            request_id,
            agent_id,
            before_run_id,
        } => {
            let query = MessageHistoryQuery {
                before: Some(before_run_id.clone()),
                limit: Some(LATEST_MESSAGE_LIMIT),
                omit_tool_data: Some(false),
                ..Default::default()
            };
            match get_agent_json(client, &token, &agent_id, &["messages"], Some(&query)) {
                Ok(page) => send_event(
                    events,
                    ChatEvent::OlderLoaded {
                        request_id,
                        agent_id,
                        before_run_id,
                        page,
                    },
                ),
                Err(error) => failed(
                    events,
                    request_id,
                    ChatOperation::LoadOlder,
                    Some(agent_id),
                    error,
                ),
            }
        }
        ChatCommand::CreateAgent {
            request_id,
            request,
        } => {
            let result = request_json(
                client,
                &token,
                Method::POST,
                &["v0", "agents"],
                None,
                Some(&request),
            );
            match result {
                Ok(response) => send_event(
                    events,
                    ChatEvent::AgentCreated {
                        request_id,
                        response,
                    },
                ),
                Err(error) => {
                    // A client-supplied ID makes creation safely confirmable
                    // after a lost POST response. Never navigate unless the
                    // exact agent exists in the requested workspace.
                    let confirmed = request.id.as_deref().and_then(|agent_id| {
                        get_agent_json::<AgentResponse>(client, &token, agent_id, &[], None)
                            .ok()
                            .filter(|response| {
                                response.agent.id == agent_id
                                    && response.agent.workspace_id == request.workspace_id
                            })
                    });
                    if let Some(response) = confirmed {
                        send_event(
                            events,
                            ChatEvent::AgentCreated {
                                request_id,
                                response,
                            },
                        );
                    } else {
                        failed(
                            events,
                            request_id,
                            ChatOperation::CreateAgent,
                            request.id,
                            error,
                        );
                    }
                }
            }
        }
        ChatCommand::ArchiveAgent {
            request_id,
            agent_id,
            request,
        } => mutation(
            client,
            &token,
            events,
            request_id,
            agent_id,
            ChatOperation::ArchiveAgent,
            Method::POST,
            &["archive"],
            &request,
            |request_id, agent_id, response| ChatEvent::AgentArchived {
                request_id,
                agent_id,
                response,
            },
        ),
        ChatCommand::UnarchiveAgent {
            request_id,
            agent_id,
            request,
        } => mutation(
            client,
            &token,
            events,
            request_id,
            agent_id,
            ChatOperation::UnarchiveAgent,
            Method::POST,
            &["unarchive"],
            &request,
            |request_id, agent_id, response| ChatEvent::AgentUnarchived {
                request_id,
                agent_id,
                response,
            },
        ),
        ChatCommand::MarkAgentRead {
            request_id,
            agent_id,
            request,
        } => mutation(
            client,
            &token,
            events,
            request_id,
            agent_id,
            ChatOperation::MarkAgentRead,
            Method::POST,
            &["read"],
            &request,
            |request_id, agent_id, response| ChatEvent::AgentMarkedRead {
                request_id,
                agent_id,
                response,
            },
        ),
        ChatCommand::ReorderAgent {
            request_id,
            agent_id,
            request,
        } => mutation(
            client,
            &token,
            events,
            request_id,
            agent_id,
            ChatOperation::ReorderAgent,
            Method::POST,
            &["reorder"],
            &request,
            |request_id, agent_id, response| ChatEvent::AgentReordered {
                request_id,
                agent_id,
                response,
            },
        ),
        ChatCommand::SaveDraft {
            request_id,
            agent_id,
            request,
        } => mutation(
            client,
            &token,
            events,
            request_id,
            agent_id,
            ChatOperation::SaveDraft,
            Method::PUT,
            &["draft"],
            &request,
            |request_id, agent_id, response| ChatEvent::DraftSaved {
                request_id,
                agent_id,
                response,
            },
        ),
        ChatCommand::SendMessage {
            request_id,
            agent_id,
            request,
        } => send_message_with_retry(client, &token, events, request_id, agent_id, request),
        ChatCommand::AbortAgent {
            request_id,
            agent_id,
            request,
        } => mutation(
            client,
            &token,
            events,
            request_id,
            agent_id,
            ChatOperation::AbortAgent,
            Method::POST,
            &["abort"],
            &request,
            |request_id, agent_id, response| ChatEvent::AgentAborted {
                request_id,
                agent_id,
                response,
            },
        ),
        ChatCommand::CompactAgent {
            request_id,
            agent_id,
            request,
        } => mutation(
            client,
            &token,
            events,
            request_id,
            agent_id,
            ChatOperation::CompactAgent,
            Method::POST,
            &["compact"],
            &request,
            |request_id, agent_id, response| ChatEvent::AgentCompacted {
                request_id,
                agent_id,
                response,
            },
        ),
        ChatCommand::AnswerQuestion {
            request_id,
            agent_id,
            question_id,
            request,
        } => mutation(
            client,
            &token,
            events,
            request_id,
            agent_id,
            ChatOperation::AnswerQuestion,
            Method::POST,
            &["question", &question_id, "answer"],
            &request,
            |request_id, agent_id, response| ChatEvent::QuestionAnswered {
                request_id,
                agent_id,
                response,
            },
        ),
        ChatCommand::InvokeSlashCommand {
            request_id,
            agent_id,
            name,
            request,
        } => mutation(
            client,
            &token,
            events,
            request_id,
            agent_id,
            ChatOperation::InvokeSlashCommand,
            Method::POST,
            &["slash-commands", &name],
            &request,
            |request_id, agent_id, response| ChatEvent::SlashCommandInvoked {
                request_id,
                agent_id,
                response,
            },
        ),
        ChatCommand::StopProcess {
            request_id,
            agent_id,
            process_id,
        } => {
            match agent_request_json::<(), BackgroundProcessResponse>(
                client,
                &token,
                Method::DELETE,
                &agent_id,
                &["processes", &process_id],
                None,
            ) {
                Ok(response) => send_event(
                    events,
                    ChatEvent::ProcessStopped {
                        request_id,
                        agent_id,
                        response,
                    },
                ),
                Err(error) => failed(
                    events,
                    request_id,
                    ChatOperation::StopProcess,
                    Some(agent_id),
                    error,
                ),
            }
        }
        ChatCommand::WakeRefresh { .. } | ChatCommand::Shutdown => {}
    }
}

fn read_focused(
    client: &Client,
    token: &SecretToken,
    agent_id: &str,
) -> Result<FocusedAgentSnapshot, UserError> {
    let bootstrap: AgentBootstrapResponse =
        get_agent_json(client, token, agent_id, &["bootstrap"], None)?;
    let history = get_agent_json(
        client,
        token,
        agent_id,
        &["messages"],
        Some(&MessageHistoryQuery {
            limit: Some(LATEST_MESSAGE_LIMIT),
            omit_tool_data: Some(false),
            ..Default::default()
        }),
    )?;
    let pending_question = if bootstrap.agent.pending_question_id.is_some() {
        get_agent_json::<PendingQuestionResponse>(client, token, agent_id, &["question"], None)?
            .question
    } else {
        None
    };
    Ok(FocusedAgentSnapshot {
        bootstrap,
        history,
        pending_question,
    })
}

fn send_message_with_retry(
    client: &Client,
    token: &SecretToken,
    events: &Sender<ChatEvent>,
    request_id: ChatRequestId,
    agent_id: String,
    request: SendMessageRequest,
) {
    let message_id = request
        .id
        .as_deref()
        .expect("send admission always supplies a client message ID");
    let mut retry_delay = INITIAL_SEND_RETRY;
    let mut last_error = unavailable_error();
    for attempt in 1..=SEND_ATTEMPTS {
        match agent_request_json(
            client,
            token,
            Method::POST,
            &agent_id,
            &["send"],
            Some(&request),
        ) {
            Ok(response) => {
                send_event(
                    events,
                    ChatEvent::MessageSent {
                        request_id,
                        agent_id,
                        response,
                    },
                );
                return;
            }
            Err(error) => {
                last_error = error;
                // Both pending and history are authoritative confirmation
                // sources. Exact client ID prevents another send from winning
                // this race or clearing the wrong optimistic entry.
                if let Some(response) = confirm_sent_message(client, token, &agent_id, message_id) {
                    send_event(
                        events,
                        ChatEvent::MessageSent {
                            request_id,
                            agent_id,
                            response,
                        },
                    );
                    return;
                }
                if attempt == SEND_ATTEMPTS || !send_error_retryable(&last_error) {
                    break;
                }
                thread::sleep(retry_delay);
                retry_delay = retry_delay.saturating_mul(2);
            }
        }
    }
    failed(
        events,
        request_id,
        ChatOperation::SendMessage,
        Some(agent_id),
        last_error,
    );
}

fn send_error_retryable(error: &UserError) -> bool {
    matches!(error.kind, UserErrorKind::Unavailable)
        || error
            .api
            .as_ref()
            .is_some_and(|api| api.status == 408 || api.status >= 500)
}

fn confirm_sent_message(
    client: &Client,
    token: &SecretToken,
    agent_id: &str,
    message_id: &str,
) -> Option<SendMessageResponse> {
    let bootstrap =
        get_agent_json::<AgentBootstrapResponse>(client, token, agent_id, &["bootstrap"], None)
            .ok();
    if let Some(bootstrap) = &bootstrap
        && let Some(message) = bootstrap
            .pending
            .iter()
            .find(|message| message.id == message_id)
            .cloned()
    {
        return Some(SendMessageResponse {
            message,
            cursor: bootstrap.cursor.clone(),
        });
    }

    let mut before = None;
    let mut inspected_messages = 0usize;
    for _ in 0..3 {
        let history = get_agent_json::<MessageHistoryResponse>(
            client,
            token,
            agent_id,
            &["messages"],
            Some(&MessageHistoryQuery {
                before: before.clone(),
                limit: Some(LATEST_MESSAGE_LIMIT),
                omit_tool_data: Some(false),
                ..Default::default()
            }),
        )
        .ok()?;
        for run in &history.runs {
            for message in &run.messages {
                inspected_messages += 1;
                if inspected_messages > 2_000 {
                    return None;
                }
                if let super::chat_protocol::Message::User(value) = message
                    && value.id == message_id
                {
                    return Some(SendMessageResponse {
                        message: UserMessage {
                            id: value.id.clone(),
                            role: UserRole::User,
                            created_at: value.created_at,
                            content: value.content.clone(),
                            metadata: value.metadata.clone(),
                            client_metadata: value.client_metadata.clone(),
                            profile: value.profile.clone(),
                            status: value.status,
                            delivery: value.delivery,
                            mode: value.mode.clone(),
                            run_id: value.run_id.clone(),
                        },
                        cursor: history.cursor,
                    });
                }
            }
        }
        if !history.has_more {
            break;
        }
        let oldest = history.runs.first()?.id.clone();
        if before.as_deref() == Some(oldest.as_str()) {
            break;
        }
        before = Some(oldest);
    }
    None
}

fn mutation<B, T>(
    client: &Client,
    token: &SecretToken,
    events: &Sender<ChatEvent>,
    request_id: ChatRequestId,
    agent_id: String,
    operation: ChatOperation,
    method: Method,
    suffix: &[&str],
    body: &B,
    event: impl FnOnce(ChatRequestId, String, T) -> ChatEvent,
) where
    B: Serialize + ?Sized,
    T: DeserializeOwned,
{
    match agent_request_json(client, token, method, &agent_id, suffix, Some(body)) {
        Ok(response) => send_event(events, event(request_id, agent_id, response)),
        Err(error) => failed(events, request_id, operation, Some(agent_id), error),
    }
}

fn get_agent_json<T>(
    client: &Client,
    token: &SecretToken,
    agent_id: &str,
    suffix: &[&str],
    query: Option<&MessageHistoryQuery>,
) -> Result<T, UserError>
where
    T: DeserializeOwned,
{
    let mut segments = vec!["v0", "agents", agent_id];
    segments.extend_from_slice(suffix);
    request_json(client, token, Method::GET, &segments, query, None::<&()>)
}

fn agent_request_json<B, T>(
    client: &Client,
    token: &SecretToken,
    method: Method,
    agent_id: &str,
    suffix: &[&str],
    body: Option<&B>,
) -> Result<T, UserError>
where
    B: Serialize + ?Sized,
    T: DeserializeOwned,
{
    let mut segments = vec!["v0", "agents", agent_id];
    segments.extend_from_slice(suffix);
    request_json(client, token, method, &segments, None, body)
}

fn request_json<B, T>(
    client: &Client,
    token: &SecretToken,
    method: Method,
    segments: &[&str],
    query: Option<&MessageHistoryQuery>,
    body: Option<&B>,
) -> Result<T, UserError>
where
    B: Serialize + ?Sized,
    T: DeserializeOwned,
{
    let mut url = Url::parse("http://happy-agent/").expect("fixed Happy Agent URL is valid");
    {
        let mut path = url
            .path_segments_mut()
            .expect("fixed URL accepts path segments");
        path.clear();
        path.extend(segments.iter().copied());
    }
    if let Some(query) = query {
        let mut pairs = url.query_pairs_mut();
        if let Some(before) = &query.before {
            pairs.append_pair("before", before);
        }
        if let Some(after) = &query.after {
            pairs.append_pair("after", after);
        }
        if let Some(limit) = query.limit {
            pairs.append_pair("limit", &limit.to_string());
        }
        if let Some(omit) = query.omit_tool_data {
            pairs.append_pair("omitToolData", if omit { "true" } else { "false" });
        }
    }
    let mut request = client
        .request(method, url)
        .timeout(Duration::from_secs(10))
        .header(ACCEPT, "application/json")
        .header(AUTHORIZATION, token.authorization());
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = checked_response(request.send().map_err(|_| unavailable_error())?, token)?;
    capped_json(response)
}

fn capped_json<T: DeserializeOwned>(response: Response) -> Result<T, UserError> {
    let bytes = capped_body(response, MAX_CHAT_RESPONSE_BYTES)?;
    serde_json::from_slice(&bytes).map_err(|_| protocol_error())
}

fn capped_body(mut response: Response, limit: u64) -> Result<Vec<u8>, UserError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err(response_too_large_error());
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable_error())?;
    if bytes.len() as u64 > limit {
        return Err(response_too_large_error());
    }
    Ok(bytes)
}

fn response_too_large_error() -> UserError {
    UserError {
        kind: UserErrorKind::Protocol,
        message: "Happy Agent returned a chat response that exceeds the safe memory limit.".into(),
        api: None,
    }
}

fn checked_response(response: Response, token: &SecretToken) -> Result<Response, UserError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let mut body = capped_body(response, MAX_API_ERROR_BODY_BYTES)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .filter(serde_json::Value::is_object);
    if let Some(body) = body.as_mut() {
        redact_value(body, token);
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
        .map(|value| bounded_utf8(&token.redact(value), MAX_API_ERROR_STRING_BYTES))
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

fn redact_value(value: &mut serde_json::Value, token: &SecretToken) {
    match value {
        serde_json::Value::String(text) => *text = token.redact(text),
        serde_json::Value::Array(values) => {
            for value in values {
                redact_value(value, token);
            }
        }
        serde_json::Value::Object(values) => {
            let mut redacted = serde_json::Map::new();
            for (key, mut value) in std::mem::take(values) {
                redact_value(&mut value, token);
                redacted.insert(token.redact(&key), value);
            }
            *values = redacted;
        }
        _ => {}
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

fn command_identity(command: &ChatCommand) -> (ChatRequestId, ChatOperation, Option<String>) {
    match command {
        ChatCommand::Focus {
            request_id,
            agent_id,
        } => (*request_id, ChatOperation::Focus, Some(agent_id.clone())),
        ChatCommand::Unfocus { request_id } => (*request_id, ChatOperation::Unfocus, None),
        ChatCommand::Refresh {
            request_id,
            agent_id,
        } => (*request_id, ChatOperation::Refresh, Some(agent_id.clone())),
        ChatCommand::LoadOlder {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::LoadOlder,
            Some(agent_id.clone()),
        ),
        ChatCommand::CreateAgent {
            request_id,
            request,
        } => (*request_id, ChatOperation::CreateAgent, request.id.clone()),
        ChatCommand::ArchiveAgent {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::ArchiveAgent,
            Some(agent_id.clone()),
        ),
        ChatCommand::UnarchiveAgent {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::UnarchiveAgent,
            Some(agent_id.clone()),
        ),
        ChatCommand::MarkAgentRead {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::MarkAgentRead,
            Some(agent_id.clone()),
        ),
        ChatCommand::ReorderAgent {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::ReorderAgent,
            Some(agent_id.clone()),
        ),
        ChatCommand::SaveDraft {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::SaveDraft,
            Some(agent_id.clone()),
        ),
        ChatCommand::SendMessage {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::SendMessage,
            Some(agent_id.clone()),
        ),
        ChatCommand::AbortAgent {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::AbortAgent,
            Some(agent_id.clone()),
        ),
        ChatCommand::CompactAgent {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::CompactAgent,
            Some(agent_id.clone()),
        ),
        ChatCommand::AnswerQuestion {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::AnswerQuestion,
            Some(agent_id.clone()),
        ),
        ChatCommand::InvokeSlashCommand {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::InvokeSlashCommand,
            Some(agent_id.clone()),
        ),
        ChatCommand::StopProcess {
            request_id,
            agent_id,
            ..
        } => (
            *request_id,
            ChatOperation::StopProcess,
            Some(agent_id.clone()),
        ),
        ChatCommand::WakeRefresh { .. } | ChatCommand::Shutdown => {
            (ChatRequestId(0), ChatOperation::Unfocus, None)
        }
    }
}

fn failed(
    events: &Sender<ChatEvent>,
    request_id: ChatRequestId,
    operation: ChatOperation,
    agent_id: Option<String>,
    error: UserError,
) {
    send_event(
        events,
        ChatEvent::Failed {
            request_id,
            operation,
            agent_id,
            error,
        },
    );
}
fn send_event(events: &Sender<ChatEvent>, event: ChatEvent) {
    let _ = events.send_blocking(event);
}
fn unavailable_error() -> UserError {
    UserError {
        kind: UserErrorKind::Unavailable,
        message: "Could not reach the Happy Agent daemon.".into(),
        api: None,
    }
}
fn protocol_error() -> UserError {
    UserError {
        kind: UserErrorKind::Protocol,
        message: "Happy Agent returned data outside protocol v23.".into(),
        api: None,
    }
}
fn stopped_error() -> UserError {
    UserError {
        kind: UserErrorKind::Unavailable,
        message: "The chat transport is stopped.".into(),
        api: None,
    }
}
fn not_focused_error() -> UserError {
    UserError {
        kind: UserErrorKind::Unavailable,
        message: "That agent is not focused.".into(),
        api: None,
    }
}
