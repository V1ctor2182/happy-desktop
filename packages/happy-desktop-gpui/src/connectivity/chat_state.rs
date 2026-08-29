//! Controller-owned glue between permanent chat stores and the coalescing chat transport.
//!
//! This module contains no shell state. Request IDs are retained as provenance so
//! an authoritative worker result can only complete the local action that admitted it.

use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};

use async_channel::{Receiver, Sender};

use crate::chat::{
    ChatMutationId, ChatOutput, ModelCatalog, ModelOption, ModelProvider, MutationId,
    WorkspaceOutput,
};

use super::{
    CatalogSnapshot, ChatRequestId, ChatTransport, ConversationKey, EventHintPayload,
    HappyAgentEventType, PermissionMode, WorkspaceKey,
    chat_protocol::{MessageMode, MessagePermissionMode},
};

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum StoreOutput {
    Chat(ChatOutput),
    Workspace(WorkspaceOutput),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreatedChatNavigation {
    pub workspace: WorkspaceKey,
    pub conversation: ConversationKey,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChatProtocolLimitations {
    pub audience_selection: bool,
    pub file_attachments: bool,
    pub message_retry: bool,
}

impl ChatProtocolLimitations {
    pub const V23: Self = Self {
        audience_selection: false,
        file_attachments: false,
        message_retry: false,
    };
}

#[derive(Clone, Debug)]
pub(crate) enum RequestProvenance {
    Focus {
        conversation: ConversationKey,
    },
    Unfocus,
    Refresh {
        conversation: ConversationKey,
        initial: bool,
    },
    Older {
        conversation: ConversationKey,
    },
    Create {
        workspace: WorkspaceKey,
        mutation: MutationId,
        agent_id: Arc<str>,
    },
    Archive {
        workspace: WorkspaceKey,
        conversation: ConversationKey,
        mutation: MutationId,
    },
    Restore {
        workspace: WorkspaceKey,
        conversation: ConversationKey,
        mutation: MutationId,
    },
    Draft {
        conversation: ConversationKey,
        revision: u64,
    },
    Mode {
        conversation: ConversationKey,
        mutation: ChatMutationId,
        mode: MessageMode,
        revision: u64,
    },
    Send {
        conversation: ConversationKey,
        mutation: ChatMutationId,
        message_id: String,
    },
    Abort {
        conversation: ConversationKey,
        mutation: ChatMutationId,
    },
    Question {
        conversation: ConversationKey,
        mutation: ChatMutationId,
    },
    Command {
        conversation: ConversationKey,
        mutation: ChatMutationId,
    },
    StopProcess {
        conversation: ConversationKey,
        mutation: ChatMutationId,
        process_id: Arc<str>,
    },
    MarkRead {
        conversation: ConversationKey,
        mutation: ChatMutationId,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct PendingDraft {
    /// Retained across admission failure/reconnect until superseded or accepted.
    pub mutation: ChatMutationId,
    pub text: Arc<str>,
    pub revision: u64,
    pub generation: u64,
    pub updated_at: i64,
}

pub(crate) struct ChatConnectivity {
    pub transport: Arc<ChatTransport>,
    pub output_tx: Sender<StoreOutput>,
    pub output_rx: Receiver<StoreOutput>,
    pub provenance: HashMap<ChatRequestId, RequestProvenance>,
    pub focused: Option<ConversationKey>,
    pub created_navigation: VecDeque<CreatedChatNavigation>,
    pub catalog: Arc<ModelCatalog>,
    pub draft_pending: HashMap<ConversationKey, PendingDraft>,
    pub draft_generation: u64,
    pub draft_timestamp_floor: HashMap<ConversationKey, i64>,
}

impl ChatConnectivity {
    pub fn new(transport: Arc<ChatTransport>) -> Self {
        // This queue is deliberately not a transport queue. Its sole producer is the
        // GPUI thread: only public local store actions emit, one active UI event emits
        // one output, and authoritative reconciliation emits none. Attachment
        // completions are the only batch producer and are capped at 32. This receiver
        // is permanent and drains on every GPUI turn. Bounding it would force either a
        // UI-thread block or lossy overflow that could strand durable mutation intent,
        // because the synchronous store listener has no fallible return channel.
        let (output_tx, output_rx) = async_channel::unbounded();
        Self {
            transport,
            output_tx,
            output_rx,
            provenance: HashMap::new(),
            focused: None,
            created_navigation: VecDeque::new(),
            catalog: Arc::new(ModelCatalog {
                providers: Vec::new(),
                permission_modes: permission_modes(),
            }),
            draft_pending: HashMap::new(),
            draft_generation: 0,
            draft_timestamp_floor: HashMap::new(),
        }
    }
}

pub(crate) fn model_catalog(config: &CatalogSnapshot) -> Arc<ModelCatalog> {
    let mut providers = Vec::new();
    for (provider_id, provider) in &config.providers {
        if !provider.enabled {
            continue;
        }
        let mut models = Vec::new();
        let mut provider_tiers = Vec::<Arc<str>>::new();
        for configured in provider.models.iter().filter(|model| model.enabled) {
            let definition = config.models.get(&configured.id);
            let efforts = configured
                .efforts
                .as_ref()
                .cloned()
                .or_else(|| definition.map(|value| value.efforts.clone()))
                .unwrap_or_default();
            let default_effort = configured
                .default_effort
                .as_ref()
                .cloned()
                .or_else(|| definition.map(|value| value.default_effort.clone()));
            let Some(default_effort) = default_effort else {
                continue;
            };
            if efforts.is_empty() || !efforts.iter().any(|value| value == &default_effort) {
                continue;
            }
            let tiers = configured
                .service_tiers
                .as_ref()
                .cloned()
                .or_else(|| definition.map(|value| value.service_tiers.clone()))
                .unwrap_or_default();
            for tier in tiers {
                let tier: Arc<str> = Arc::from(tier);
                if !provider_tiers.contains(&tier) {
                    provider_tiers.push(tier);
                }
            }
            models.push(Arc::new(ModelOption {
                id: Arc::from(configured.id.as_str()),
                efforts: efforts.into_iter().map(Arc::from).collect(),
                default_effort: Arc::from(default_effort),
            }));
        }
        providers.push(Arc::new(ModelProvider {
            id: Arc::from(provider_id.as_str()),
            models,
            service_tiers: provider_tiers,
        }));
    }
    Arc::new(ModelCatalog {
        providers,
        permission_modes: permission_modes(),
    })
}

fn permission_modes() -> Vec<MessagePermissionMode> {
    [
        PermissionMode::ReadOnly,
        PermissionMode::WorkspaceWrite,
        PermissionMode::Auto,
        PermissionMode::FullAccess,
    ]
    .into_iter()
    .map(|value| match value {
        PermissionMode::ReadOnly => MessagePermissionMode::ReadOnly,
        PermissionMode::WorkspaceWrite => MessagePermissionMode::WorkspaceWrite,
        PermissionMode::Auto => MessagePermissionMode::Auto,
        PermissionMode::FullAccess => MessagePermissionMode::FullAccess,
    })
    .collect()
}

/// Returns a directly carried agent identity for event kinds whose v23 payload
/// contract names an agent. Process/question-only hints are resolved from the
/// focused store by the controller instead of being guessed here.
pub(crate) fn hinted_agent(event: HappyAgentEventType, payload: &EventHintPayload) -> Option<&str> {
    use HappyAgentEventType::*;
    match event {
        AgentCreated | AgentUpdated => payload
            .agent_id
            .as_deref()
            .or_else(|| payload.agent.as_ref().and_then(|value| value.id.as_deref())),
        AgentContextUpdated => payload.agent_id.as_deref().or_else(|| {
            payload
                .context
                .as_ref()
                .and_then(|value| value.agent_id.as_deref())
        }),
        AgentDraftUpdated => payload.agent_id.as_deref().or_else(|| {
            payload
                .draft
                .as_ref()
                .and_then(|value| value.agent_id.as_deref())
        }),
        AgentSlashCommandsUpdated => payload.agent_id.as_deref().or_else(|| {
            payload
                .commands
                .as_ref()
                .and_then(|value| value.agent_id.as_deref())
        }),
        MessageCreated | MessageUpdated | MessageDelta | MessageDeleted => {
            payload.agent_id.as_deref().or_else(|| {
                payload
                    .message
                    .as_ref()
                    .and_then(|value| value.agent_id.as_deref())
            })
        }
        RunStarted | RunBoundary | RunFinished => payload.agent_id.as_deref().or_else(|| {
            payload
                .run
                .as_ref()
                .and_then(|value| value.agent_id.as_deref())
        }),
        ProcessStarted | ProcessUpdated | ProcessExited => {
            payload.agent_id.as_deref().or_else(|| {
                payload
                    .process
                    .as_ref()
                    .and_then(|value| value.agent_id.as_deref())
            })
        }
        QuestionCreated | QuestionUpdated => payload.agent_id.as_deref().or_else(|| {
            payload
                .question
                .as_ref()
                .and_then(|value| value.agent_id.as_deref())
        }),
        _ => None,
    }
}
