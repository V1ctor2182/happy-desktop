//! Framework-neutral state for one focused Happy Agent conversation.
//!
//! The store owns immutable snapshots and synchronous local intent. Construction
//! opens no transport, timers, persistence, authentication, or UI resources.

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};

use crate::connectivity::{
    Agent, ConversationKey,
    chat_protocol::{
        AgentBootstrapResponse, AgentContextUsage, AgentDraftSnapshot, BackgroundProcess,
        HistoryRun, Message, MessageBlock, MessageDelivery, MessageMode, MessagePermissionMode,
        Question, SlashCommand, UsageBreakdown, UserMessage,
    },
};

pub const MAX_INLINE_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_DRAFT_BYTES: usize = 64 * 1024;
/// Permanent chat stores retain a bounded transcript window. Older content can
/// always be fetched again from the authoritative history route.
const MAX_HISTORY_PAGES: usize = 12;
const MAX_HISTORY_MESSAGES: usize = 2_000;
const MAX_HISTORY_TOTAL_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;
const MAX_COMPOSER_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PENDING_USER_MESSAGES: usize = 200;
const MAX_PENDING_IMAGE_BASE64_BYTES: usize = 20 * 1024 * 1024;
const MAX_PENDING_TOTAL_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;
/// Conservative heap/node estimate for Vec/map entries and enum/Arc allocation.
const RETAINED_NODE_OVERHEAD: usize = 128;
const MAX_RETAINED_CURSOR_BYTES: usize = 64 * 1024;

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
opaque_id!(ChatMutationId);
opaque_id!(AttachmentId);

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ClientMessageId(Arc<str>);
impl ClientMessageId {
    /// CUID2 is lowercase alphanumeric, begins with a letter, and is bounded.
    /// The caller mints it so retries can reuse the exact same message identity.
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
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadState {
    Initial,
    Loading,
    Ready,
    Error { message: Arc<str> },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OperationState {
    Idle,
    Pending { mutation: ChatMutationId },
    Failed { message: Arc<str> },
}
impl Default for OperationState {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentAvailability {
    Online,
    Unavailable { reason: Arc<str> },
}
impl AgentAvailability {
    fn refusal(&self) -> Option<Arc<str>> {
        match self {
            Self::Online => None,
            Self::Unavailable { reason } => Some(Arc::clone(reason)),
        }
    }
}

/// Protocol-v23 has no audience transport. Product UI must present this fact,
/// rather than showing a control backed by a guessed request field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudienceSupport {
    UnsupportedByProtocol,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelCatalog {
    pub providers: Vec<Arc<ModelProvider>>,
    pub permission_modes: Vec<MessagePermissionMode>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelProvider {
    pub id: Arc<str>,
    pub models: Vec<Arc<ModelOption>>,
    pub service_tiers: Vec<Arc<str>>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelOption {
    pub id: Arc<str>,
    pub efforts: Vec<Arc<str>>,
    pub default_effort: Arc<str>,
}

impl ModelCatalog {
    fn provider(&self, id: &str) -> Option<&ModelProvider> {
        self.providers
            .iter()
            .find(|p| p.id.as_ref() == id)
            .map(AsRef::as_ref)
    }
    fn model(&self, provider: &str, model: &str) -> Option<&ModelOption> {
        self.provider(provider)?
            .models
            .iter()
            .find(|m| m.id.as_ref() == model)
            .map(AsRef::as_ref)
    }
    fn accepts_mode(&self, mode: &MessageMode) -> bool {
        self.model(&mode.provider_id, &mode.model_id)
            .is_some_and(|model| {
                model.efforts.iter().any(|v| v.as_ref() == mode.effort)
                    && self.permission_modes.contains(&mode.permission_mode)
                    && mode.service_tier.as_deref().is_none_or(|tier| {
                        self.provider(&mode.provider_id)
                            .is_some_and(|p| p.service_tiers.iter().any(|v| v.as_ref() == tier))
                    })
            })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttachmentState {
    Ready,
    Failed { message: Arc<str> },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InlineImageAttachment {
    pub id: AttachmentId,
    pub name: Arc<str>,
    pub mime_type: Arc<str>,
    /// Base64 without a data-URL prefix, matching `SendMessageBlock::Image`.
    pub data: Arc<str>,
    pub byte_size: u64,
    pub state: AttachmentState,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttachmentRejection {
    DuplicateId,
    EmptyData,
    InvalidBase64,
    SizeMismatch,
    UnsupportedMimeType,
    TooLarge { limit: u64 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingMessageSend {
    pub id: ClientMessageId,
    /// One logical mutation survives transport retries and explicit store retry.
    pub mutation: ChatMutationId,
    pub text: Arc<str>,
    pub images: Vec<Arc<InlineImageAttachment>>,
    pub mode: MessageMode,
    pub delivery: MessageDelivery,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComposerSnapshot {
    pub text: Arc<str>,
    pub revision: u64,
    /// Local text must not be replaced by bootstrap while dirty or in flight.
    pub draft_dirty: bool,
    pub draft_inflight_revision: Option<u64>,
    pub draft_updated_at: Option<i64>,
    pub attachments: Vec<Arc<InlineImageAttachment>>,
    pub mode: Option<MessageMode>,
    pub command_query: Arc<str>,
    pub selected_command: Option<Arc<str>>,
    pub question_selections: BTreeMap<Arc<str>, BTreeSet<Arc<str>>>,
    pub draft_save: OperationState,
    pub mode_save: OperationState,
    pub message_send: OperationState,
    pub sending_revision: Option<u64>,
    pub pending_send: Option<PendingMessageSend>,
    pub abort: OperationState,
    pub command: OperationState,
    pub question_submit: OperationState,
}
impl ComposerSnapshot {
    fn empty() -> Self {
        Self {
            text: Arc::from(""),
            revision: 0,
            draft_dirty: false,
            draft_inflight_revision: None,
            draft_updated_at: None,
            attachments: Vec::new(),
            mode: None,
            command_query: Arc::from(""),
            selected_command: None,
            question_selections: BTreeMap::new(),
            draft_save: OperationState::Idle,
            mode_save: OperationState::Idle,
            message_send: OperationState::Idle,
            sending_revision: None,
            pending_send: None,
            abort: OperationState::Idle,
            command: OperationState::Idle,
            question_submit: OperationState::Idle,
        }
    }
}

/// A whole daemon history page. Runs and their messages have separate Arc
/// identity so latest replacement and older prepends can retain unchanged rows.
#[derive(Clone, Debug, PartialEq)]
pub struct HistoryPage {
    pub cursor: Arc<str>,
    pub has_more: bool,
    pub runs: Vec<Arc<ChatRun>>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct ChatRun {
    pub value: Arc<HistoryRun>,
    pub messages: Vec<Arc<Message>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChatSnapshot {
    pub conversation: ConversationKey,
    pub load: LoadState,
    pub refresh: OperationState,
    pub availability: AgentAvailability,
    pub audience: AudienceSupport,
    pub agent: Option<Arc<Agent>>,
    pub cursor: Option<Arc<str>>,
    pub mode: Option<MessageMode>,
    pub context: Option<Arc<AgentContextUsage>>,
    pub usage: Arc<UsageBreakdown>,
    pub slash_commands: Vec<Arc<SlashCommand>>,
    pub question: Option<Arc<Question>>,
    pub processes: Vec<Arc<BackgroundProcess>>,
    pub subagents: Vec<Arc<Agent>>,
    pub history_pages: Vec<Arc<HistoryPage>>,
    pub pending_user_messages: Vec<Arc<UserMessage>>,
    pub pending_error: Option<Arc<str>>,
    pub has_more: bool,
    /// Retention omitted older messages or image payloads from this permanent store.
    pub history_truncated: bool,
    pub loading_older: bool,
    pub older_error: Option<Arc<str>>,
    pub composer: Arc<ComposerSnapshot>,
    pub process_operations: BTreeMap<Arc<str>, OperationState>,
    pub retry: BTreeMap<Arc<str>, OperationState>,
    pub mark_read: OperationState,
}
impl ChatSnapshot {
    fn empty(conversation: ConversationKey) -> Self {
        Self {
            conversation,
            load: LoadState::Initial,
            refresh: OperationState::Idle,
            availability: AgentAvailability::Unavailable {
                reason: Arc::from("Conversation has not connected yet"),
            },
            audience: AudienceSupport::UnsupportedByProtocol,
            agent: None,
            cursor: None,
            mode: None,
            context: None,
            usage: Arc::new(BTreeMap::new()),
            slash_commands: Vec::new(),
            question: None,
            processes: Vec::new(),
            subagents: Vec::new(),
            history_pages: Vec::new(),
            pending_user_messages: Vec::new(),
            pending_error: None,
            has_more: false,
            history_truncated: false,
            loading_older: false,
            older_error: None,
            composer: Arc::new(ComposerSnapshot::empty()),
            process_operations: BTreeMap::new(),
            retry: BTreeMap::new(),
            mark_read: OperationState::Idle,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ChatOutput {
    DraftUpdated {
        conversation: ConversationKey,
        text: Arc<str>,
        revision: u64,
    },
    ImageAttachmentAdded {
        conversation: ConversationKey,
        attachment: Arc<InlineImageAttachment>,
    },
    ImageAttachmentRemoved {
        conversation: ConversationKey,
        attachment: AttachmentId,
    },
    ImageAttachmentRetryRequested {
        conversation: ConversationKey,
        attachment: AttachmentId,
    },
    ModeSaveRequested {
        conversation: ConversationKey,
        mode: MessageMode,
        mutation: ChatMutationId,
    },
    MessageSendRequested {
        conversation: ConversationKey,
        id: ClientMessageId,
        text: Arc<str>,
        images: Vec<Arc<InlineImageAttachment>>,
        mode: MessageMode,
        delivery: MessageDelivery,
        mutation: ChatMutationId,
    },
    AbortRequested {
        conversation: ConversationKey,
        expected_run_id: Option<Arc<str>>,
        mutation: ChatMutationId,
    },
    HistoryOlderRequested {
        conversation: ConversationKey,
        before: Option<Arc<str>>,
    },
    MessageRetryRequested {
        conversation: ConversationKey,
        message_id: Arc<str>,
        mutation: ChatMutationId,
    },
    MarkReadRequested {
        conversation: ConversationKey,
        mutation: ChatMutationId,
    },
    SlashCommandRequested {
        conversation: ConversationKey,
        command: Arc<str>,
        arguments: Option<Arc<str>>,
        mode: MessageMode,
        mutation: ChatMutationId,
    },
    QuestionSubmitRequested {
        conversation: ConversationKey,
        question_id: Arc<str>,
        answers: BTreeMap<Arc<str>, Vec<Arc<str>>>,
        mutation: ChatMutationId,
    },
    ProcessStopRequested {
        conversation: ConversationKey,
        process_id: Arc<str>,
        mutation: ChatMutationId,
    },
}

type OutputListener = Arc<dyn Fn(ChatOutput) + Send + Sync + 'static>;

pub struct ChatStore {
    snapshot: Arc<ChatSnapshot>,
    catalog: Arc<ModelCatalog>,
    output: OutputListener,
}

impl ChatStore {
    pub fn new(conversation: ConversationKey, catalog: Arc<ModelCatalog>) -> Self {
        Self::with_listener(conversation, catalog, |_| {})
    }
    pub fn with_listener(
        conversation: ConversationKey,
        catalog: Arc<ModelCatalog>,
        output: impl Fn(ChatOutput) + Send + Sync + 'static,
    ) -> Self {
        Self {
            snapshot: Arc::new(ChatSnapshot::empty(conversation)),
            catalog,
            output: Arc::new(output),
        }
    }
    pub fn snapshot(&self) -> &Arc<ChatSnapshot> {
        &self.snapshot
    }
    pub fn model_catalog(&self) -> &Arc<ModelCatalog> {
        &self.catalog
    }
    /// Reconciles config changes without replacing this permanent store.
    pub fn catalog_reconcile(&mut self, catalog: Arc<ModelCatalog>) {
        self.catalog = catalog;
        let mut next = (*self.snapshot).clone();
        let composer = Arc::make_mut(&mut next.composer);
        if composer
            .mode
            .as_ref()
            .is_some_and(|mode| !self.catalog.accepts_mode(mode))
        {
            composer.mode = next
                .mode
                .clone()
                .filter(|mode| self.catalog.accepts_mode(mode));
        }
        self.set(next);
    }
    pub fn authoritative(&mut self) -> ChatAuthoritativeWriter<'_> {
        ChatAuthoritativeWriter { store: self }
    }

    pub fn draft_text_update(&mut self, text: impl Into<Arc<str>>) {
        let text = truncate_utf8(text.into(), MAX_DRAFT_BYTES);
        if self.snapshot.composer.text == text {
            return;
        }
        let mut next = (*self.snapshot).clone();
        let composer = Arc::make_mut(&mut next.composer);
        composer.text = Arc::clone(&text);
        composer.revision += 1;
        composer.draft_dirty = true;
        composer.draft_save = OperationState::Idle;
        let revision = composer.revision;
        let conversation = next.conversation.clone();
        self.set(next);
        (self.output)(ChatOutput::DraftUpdated {
            conversation,
            text,
            revision,
        });
    }

    pub fn image_attachment_add(
        &mut self,
        attachment: InlineImageAttachment,
    ) -> Result<(), AttachmentRejection> {
        if !inline_image_mime_supported(&attachment.mime_type) {
            return Err(AttachmentRejection::UnsupportedMimeType);
        }
        if attachment.byte_size > MAX_INLINE_IMAGE_BYTES
            || attachment.data.len() > ((MAX_INLINE_IMAGE_BYTES as usize + 2) / 3) * 4
        {
            return Err(AttachmentRejection::TooLarge {
                limit: MAX_INLINE_IMAGE_BYTES,
            });
        }
        if self
            .snapshot
            .composer
            .attachments
            .iter()
            .map(|value| value.byte_size)
            .sum::<u64>()
            .saturating_add(attachment.byte_size)
            > MAX_COMPOSER_IMAGE_BYTES
        {
            return Err(AttachmentRejection::TooLarge {
                limit: MAX_COMPOSER_IMAGE_BYTES,
            });
        }
        if attachment.data.is_empty() {
            return Err(AttachmentRejection::EmptyData);
        }
        let decoded = BASE64_STANDARD
            .decode(attachment.data.as_bytes())
            .map_err(|_| AttachmentRejection::InvalidBase64)?;
        if decoded.len() as u64 != attachment.byte_size {
            return Err(AttachmentRejection::SizeMismatch);
        }
        if self
            .snapshot
            .composer
            .attachments
            .iter()
            .any(|a| a.id == attachment.id)
        {
            return Err(AttachmentRejection::DuplicateId);
        }
        let attachment = Arc::new(attachment);
        let mut next = (*self.snapshot).clone();
        Arc::make_mut(&mut next.composer)
            .attachments
            .push(Arc::clone(&attachment));
        let conversation = next.conversation.clone();
        self.set(next);
        (self.output)(ChatOutput::ImageAttachmentAdded {
            conversation,
            attachment,
        });
        Ok(())
    }
    pub fn image_attachment_remove(&mut self, id: &AttachmentId) -> bool {
        if !self
            .snapshot
            .composer
            .attachments
            .iter()
            .any(|a| &a.id == id)
        {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        Arc::make_mut(&mut next.composer)
            .attachments
            .retain(|a| &a.id != id);
        let conversation = next.conversation.clone();
        self.set(next);
        (self.output)(ChatOutput::ImageAttachmentRemoved {
            conversation,
            attachment: id.clone(),
        });
        true
    }
    pub fn image_attachment_retry(&mut self, id: &AttachmentId) -> bool {
        let Some(index) = self
            .snapshot
            .composer
            .attachments
            .iter()
            .position(|a| &a.id == id && matches!(a.state, AttachmentState::Failed { .. }))
        else {
            return false;
        };
        let mut next = (*self.snapshot).clone();
        let composer = Arc::make_mut(&mut next.composer);
        let mut value = (*composer.attachments[index]).clone();
        value.state = AttachmentState::Ready;
        composer.attachments[index] = Arc::new(value);
        let conversation = next.conversation.clone();
        self.set(next);
        (self.output)(ChatOutput::ImageAttachmentRetryRequested {
            conversation,
            attachment: id.clone(),
        });
        true
    }

    pub fn model_update(
        &mut self,
        provider_id: &str,
        model_id: &str,
        mutation: ChatMutationId,
    ) -> bool {
        let Some(model) = self.catalog.model(provider_id, model_id) else {
            return false;
        };
        let Some(current) = self
            .snapshot
            .composer
            .mode
            .clone()
            .or_else(|| self.snapshot.mode.clone())
        else {
            return false;
        };
        let mut mode = current;
        mode.provider_id = provider_id.into();
        mode.model_id = model_id.into();
        mode.effort = model.default_effort.to_string();
        mode.service_tier = mode.service_tier.filter(|tier| {
            self.catalog
                .provider(provider_id)
                .is_some_and(|p| p.service_tiers.iter().any(|v| v.as_ref() == tier))
        });
        self.mode_local_update(mode, mutation)
    }
    pub fn effort_update(&mut self, effort: &str, mutation: ChatMutationId) -> bool {
        let Some(mut mode) = self
            .snapshot
            .composer
            .mode
            .clone()
            .or_else(|| self.snapshot.mode.clone())
        else {
            return false;
        };
        if !self
            .catalog
            .model(&mode.provider_id, &mode.model_id)
            .is_some_and(|m| m.efforts.iter().any(|v| v.as_ref() == effort))
        {
            return false;
        }
        mode.effort = effort.into();
        self.mode_local_update(mode, mutation)
    }
    pub fn permission_update(
        &mut self,
        permission_mode: MessagePermissionMode,
        mutation: ChatMutationId,
    ) -> bool {
        if !self.catalog.permission_modes.contains(&permission_mode) {
            return false;
        }
        let Some(mut mode) = self
            .snapshot
            .composer
            .mode
            .clone()
            .or_else(|| self.snapshot.mode.clone())
        else {
            return false;
        };
        mode.permission_mode = permission_mode;
        self.mode_local_update(mode, mutation)
    }
    pub fn tier_update(&mut self, service_tier: Option<&str>, mutation: ChatMutationId) -> bool {
        let Some(mut mode) = self
            .snapshot
            .composer
            .mode
            .clone()
            .or_else(|| self.snapshot.mode.clone())
        else {
            return false;
        };
        if service_tier.is_some_and(|tier| {
            !self
                .catalog
                .provider(&mode.provider_id)
                .is_some_and(|p| p.service_tiers.iter().any(|v| v.as_ref() == tier))
        }) {
            return false;
        }
        mode.service_tier = service_tier.map(str::to_owned);
        self.mode_local_update(mode, mutation)
    }
    fn mode_local_update(&mut self, mode: MessageMode, mutation: ChatMutationId) -> bool {
        if !self.catalog.accepts_mode(&mode) {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        let composer = Arc::make_mut(&mut next.composer);
        composer.mode = Some(mode.clone());
        let refusal = next.availability.refusal();
        composer.mode_save = refusal.as_ref().map_or(
            OperationState::Pending {
                mutation: mutation.clone(),
            },
            |message| OperationState::Failed {
                message: Arc::clone(message),
            },
        );
        let conversation = next.conversation.clone();
        self.set(next);
        if refusal.is_none() {
            (self.output)(ChatOutput::ModeSaveRequested {
                conversation,
                mode,
                mutation,
            });
        }
        true
    }

    pub fn command_query_update(&mut self, query: impl Into<Arc<str>>) {
        let query = query.into();
        let mut next = (*self.snapshot).clone();
        let composer = Arc::make_mut(&mut next.composer);
        composer.command_query = query;
        composer.selected_command = None;
        self.set(next);
    }
    pub fn command_select(
        &mut self,
        name: &str,
        arguments: Option<Arc<str>>,
        mutation: ChatMutationId,
    ) -> bool {
        let Some(command) = self.snapshot.slash_commands.iter().find(|c| c.name == name) else {
            return false;
        };
        if arguments.is_some() && !command.has_arguments {
            return false;
        }
        let Some(mode) = self
            .snapshot
            .composer
            .mode
            .clone()
            .or_else(|| self.snapshot.mode.clone())
        else {
            return false;
        };
        let Some(_) = self.begin_online_composer_operation(|c| &mut c.command, mutation.clone())
        else {
            return false;
        };
        let mut next = (*self.snapshot).clone();
        Arc::make_mut(&mut next.composer).selected_command = Some(Arc::from(name));
        self.set(next);
        (self.output)(ChatOutput::SlashCommandRequested {
            conversation: self.snapshot.conversation.clone(),
            command: Arc::from(name),
            arguments,
            mode,
            mutation,
        });
        true
    }
    pub fn emoji_insert(&mut self, byte_offset: usize, emoji: &str) -> bool {
        if emoji.is_empty()
            || byte_offset > self.snapshot.composer.text.len()
            || !self.snapshot.composer.text.is_char_boundary(byte_offset)
        {
            return false;
        }
        let mut text = self.snapshot.composer.text.to_string();
        text.insert_str(byte_offset, emoji);
        self.draft_text_update(Arc::from(text));
        true
    }

    pub fn question_selection_update(
        &mut self,
        prompt_id: &str,
        option: &str,
        selected: bool,
    ) -> bool {
        let Some(question) = &self.snapshot.question else {
            return false;
        };
        if question.status != crate::connectivity::chat_protocol::QuestionStatus::Pending {
            return false;
        }
        let Some(prompt) = question.questions.iter().find(|p| p.id == prompt_id) else {
            return false;
        };
        if !prompt.options.iter().any(|v| v.label == option) {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        let selections = &mut Arc::make_mut(&mut next.composer).question_selections;
        let values = selections.entry(Arc::from(prompt_id)).or_default();
        if !prompt.multi_select && selected {
            values.clear();
        }
        if selected {
            values.insert(Arc::from(option));
        } else {
            values.remove(option);
        }
        self.set(next);
        true
    }
    pub fn question_free_text_update(&mut self, prompt_id: &str, value: &str) -> bool {
        let Some(question) = &self.snapshot.question else {
            return false;
        };
        if question.status != crate::connectivity::chat_protocol::QuestionStatus::Pending {
            return false;
        }
        let Some(prompt) = question
            .questions
            .iter()
            .find(|prompt| prompt.id == prompt_id)
        else {
            return false;
        };
        if !prompt.options.is_empty() {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        let selections = &mut Arc::make_mut(&mut next.composer).question_selections;
        if value.trim().is_empty() {
            selections.remove(prompt_id);
        } else {
            let mut answer = BTreeSet::new();
            answer.insert(Arc::from(value));
            selections.insert(Arc::from(prompt_id), answer);
        }
        self.set(next);
        true
    }

    pub fn question_submit(&mut self, mutation: ChatMutationId) -> bool {
        let Some(question) = self.snapshot.question.clone() else {
            return false;
        };
        if question.status != crate::connectivity::chat_protocol::QuestionStatus::Pending {
            return false;
        }
        if question.questions.iter().any(|p| {
            self.snapshot
                .composer
                .question_selections
                .get(p.id.as_str())
                .is_none_or(BTreeSet::is_empty)
        }) {
            return false;
        }
        let answers = question
            .questions
            .iter()
            .filter_map(|prompt| {
                self.snapshot
                    .composer
                    .question_selections
                    .get(prompt.id.as_str())
                    .map(|values| {
                        (
                            Arc::from(prompt.id.as_str()),
                            values.iter().cloned().collect(),
                        )
                    })
            })
            .collect();
        if self
            .begin_online_composer_operation(|c| &mut c.question_submit, mutation.clone())
            .is_none()
        {
            return false;
        }
        (self.output)(ChatOutput::QuestionSubmitRequested {
            conversation: self.snapshot.conversation.clone(),
            question_id: Arc::from(question.id.as_str()),
            answers,
            mutation,
        });
        true
    }

    pub fn message_submit(&mut self, id: ClientMessageId, mutation: ChatMutationId) -> bool {
        self.message_send(id, mutation, MessageDelivery::Queue)
    }
    pub fn message_steer(&mut self, id: ClientMessageId, mutation: ChatMutationId) -> bool {
        self.message_send(id, mutation, MessageDelivery::Steer)
    }
    fn message_send(
        &mut self,
        id: ClientMessageId,
        mutation: ChatMutationId,
        delivery: MessageDelivery,
    ) -> bool {
        let composer = &self.snapshot.composer;
        if composer.text.trim().is_empty() && composer.attachments.is_empty() {
            return false;
        }
        if composer
            .attachments
            .iter()
            .any(|a| !matches!(a.state, AttachmentState::Ready))
        {
            return false;
        }
        let Some(mode) = composer.mode.clone().or_else(|| self.snapshot.mode.clone()) else {
            return false;
        };
        if self
            .begin_online_composer_operation(|c| &mut c.message_send, mutation.clone())
            .is_none()
        {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        let revision = next.composer.revision;
        let pending = PendingMessageSend {
            id,
            mutation: mutation.clone(),
            text: Arc::clone(&next.composer.text),
            images: next.composer.attachments.clone(),
            mode,
            delivery,
        };
        let composer = Arc::make_mut(&mut next.composer);
        composer.sending_revision = Some(revision);
        composer.pending_send = Some(pending.clone());
        self.set(next);
        self.emit_pending_send(pending, mutation);
        true
    }

    pub fn message_send_retry(&mut self) -> bool {
        if !matches!(
            self.snapshot.composer.message_send,
            OperationState::Failed { .. }
        ) {
            return false;
        }
        let Some(pending) = self.snapshot.composer.pending_send.clone() else {
            return false;
        };
        if self
            .begin_online_composer_operation(
                |composer| &mut composer.message_send,
                pending.mutation.clone(),
            )
            .is_none()
        {
            return false;
        }
        let mutation = pending.mutation.clone();
        self.emit_pending_send(pending, mutation);
        true
    }

    fn emit_pending_send(&self, pending: PendingMessageSend, mutation: ChatMutationId) {
        (self.output)(ChatOutput::MessageSendRequested {
            conversation: self.snapshot.conversation.clone(),
            id: pending.id,
            text: pending.text,
            images: pending.images,
            mode: pending.mode,
            delivery: pending.delivery,
            mutation,
        });
    }

    pub fn abort(&mut self, expected_run_id: Option<Arc<str>>, mutation: ChatMutationId) -> bool {
        if self
            .begin_online_composer_operation(|c| &mut c.abort, mutation.clone())
            .is_none()
        {
            return false;
        }
        (self.output)(ChatOutput::AbortRequested {
            conversation: self.snapshot.conversation.clone(),
            expected_run_id,
            mutation,
        });
        true
    }
    pub fn history_older(&mut self) -> bool {
        if self.snapshot.loading_older
            || !self.snapshot.has_more
            || self.snapshot.availability.refusal().is_some()
        {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        next.loading_older = true;
        next.older_error = None;
        // Protocol `before` is a run ID, not the response cursor. Always page
        // from the oldest retained run across the complete retained window.
        let before = next
            .history_pages
            .iter()
            .flat_map(|page| page.runs.iter())
            .next()
            .map(|run| Arc::from(run.value.id.as_str()));
        let conversation = next.conversation.clone();
        self.set(next);
        (self.output)(ChatOutput::HistoryOlderRequested {
            conversation,
            before,
        });
        true
    }
    pub fn message_retry(
        &mut self,
        message_id: impl Into<Arc<str>>,
        mutation: ChatMutationId,
    ) -> bool {
        let id = message_id.into();
        if id.is_empty() || self.snapshot.availability.refusal().is_some() {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        next.retry.insert(
            Arc::clone(&id),
            OperationState::Pending {
                mutation: mutation.clone(),
            },
        );
        let conversation = next.conversation.clone();
        self.set(next);
        (self.output)(ChatOutput::MessageRetryRequested {
            conversation,
            message_id: id,
            mutation,
        });
        true
    }
    pub fn mark_read(&mut self, mutation: ChatMutationId) -> bool {
        if self.snapshot.availability.refusal().is_some()
            || matches!(self.snapshot.mark_read, OperationState::Pending { .. })
        {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        next.mark_read = OperationState::Pending {
            mutation: mutation.clone(),
        };
        let conversation = next.conversation.clone();
        self.set(next);
        (self.output)(ChatOutput::MarkReadRequested {
            conversation,
            mutation,
        });
        true
    }
    pub fn process_stop(
        &mut self,
        process_id: impl Into<Arc<str>>,
        mutation: ChatMutationId,
    ) -> bool {
        let id = process_id.into();
        if !self.snapshot.processes.iter().any(|p| p.id == id.as_ref())
            || self.snapshot.availability.refusal().is_some()
        {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        next.process_operations.insert(
            Arc::clone(&id),
            OperationState::Pending {
                mutation: mutation.clone(),
            },
        );
        let conversation = next.conversation.clone();
        self.set(next);
        (self.output)(ChatOutput::ProcessStopRequested {
            conversation,
            process_id: id,
            mutation,
        });
        true
    }

    fn begin_online_composer_operation(
        &mut self,
        field: impl FnOnce(&mut ComposerSnapshot) -> &mut OperationState,
        mutation: ChatMutationId,
    ) -> Option<()> {
        let refusal = self.snapshot.availability.refusal();
        let mut next = (*self.snapshot).clone();
        let state = field(Arc::make_mut(&mut next.composer));
        if matches!(state, OperationState::Pending { .. }) {
            return None;
        }
        *state = refusal
            .as_ref()
            .map_or(OperationState::Pending { mutation }, |message| {
                OperationState::Failed {
                    message: Arc::clone(message),
                }
            });
        self.set(next);
        refusal.is_none().then_some(())
    }
    fn set(&mut self, next: ChatSnapshot) {
        self.snapshot = Arc::new(next);
    }
}

/// Authoritative input cannot accidentally emit local intent. Obtain this
/// short-lived writer from [`ChatStore::authoritative`].
pub struct ChatAuthoritativeWriter<'a> {
    store: &'a mut ChatStore,
}
impl ChatAuthoritativeWriter<'_> {
    pub fn load_started(&mut self) {
        let mut n = (*self.store.snapshot).clone();
        n.load = LoadState::Loading;
        self.store.set(n);
    }
    pub fn load_failed(&mut self, message: impl Into<Arc<str>>) {
        let mut n = (*self.store.snapshot).clone();
        n.load = LoadState::Error {
            message: message.into(),
        };
        self.store.set(n);
    }
    pub fn availability_reconcile(&mut self, value: AgentAvailability) {
        let mut n = (*self.store.snapshot).clone();
        n.availability = value;
        self.store.set(n);
    }
    pub fn agent_reconcile(&mut self, value: Agent) {
        let mut n = (*self.store.snapshot).clone();
        n.agent = Some(arc_reuse(n.agent.as_ref(), value));
        self.store.set(n);
    }
    pub fn mode_reconcile(&mut self, value: Option<MessageMode>) {
        let mut n = (*self.store.snapshot).clone();
        n.mode = value.clone();
        if n.composer.mode_save == OperationState::Idle {
            Arc::make_mut(&mut n.composer).mode = value;
        }
        self.store.set(n);
    }
    pub fn usage_reconcile(&mut self, context: Option<AgentContextUsage>, usage: UsageBreakdown) {
        let mut n = (*self.store.snapshot).clone();
        n.context = reuse_option(n.context.as_ref(), context);
        n.usage = arc_reuse(Some(&n.usage), usage);
        self.store.set(n);
    }
    pub fn slash_commands_reconcile(&mut self, values: Vec<SlashCommand>) {
        let mut n = (*self.store.snapshot).clone();
        n.slash_commands = reuse_vec(&n.slash_commands, &values, |value| value.name.as_str());
        self.store.set(n);
    }
    pub fn pending_user_messages_reconcile(&mut self, values: Vec<UserMessage>) {
        let mut n = (*self.store.snapshot).clone();
        let start = pending_user_start(&values);
        n.pending_error = (start > 0).then(pending_omission_notice);
        n.pending_user_messages = reuse_vec(&n.pending_user_messages, &values[start..], |value| {
            value.id.as_str()
        });
        self.store.set(n);
    }
    pub fn bootstrap_reconcile(&mut self, value: AgentBootstrapResponse) {
        let old = &self.store.snapshot;
        let bootstrap = value;
        let mut n = (**old).clone();
        n.load = LoadState::Ready;
        n.agent = reuse_option(n.agent.as_ref(), Some(bootstrap.agent.clone()));
        if bootstrap.cursor.len() <= MAX_RETAINED_CURSOR_BYTES {
            n.cursor = Some(Arc::from(bootstrap.cursor.as_str()));
        } else {
            n.cursor = None;
            n.history_truncated = true;
        }
        n.mode = bootstrap.mode.clone();
        n.context = reuse_option(n.context.as_ref(), bootstrap.context.clone());
        n.usage = arc_reuse(Some(&n.usage), bootstrap.usage.clone());
        n.slash_commands = reuse_vec(&n.slash_commands, &bootstrap.slash_commands, |v| {
            v.name.as_str()
        });
        if let Some(processes) = bootstrap.processes.as_ref() {
            n.processes = reuse_vec(&n.processes, processes, |v| v.id.as_str());
        }
        if let Some(subagents) = bootstrap.subagents.as_ref() {
            n.subagents = reuse_vec(&n.subagents, subagents, |v| v.id.as_str());
        }
        let pending_start = pending_user_start(&bootstrap.pending);
        n.pending_error = (pending_start > 0).then(pending_omission_notice);
        n.pending_user_messages = reuse_vec(
            &n.pending_user_messages,
            &bootstrap.pending[pending_start..],
            |v| v.id.as_str(),
        );
        let composer = Arc::make_mut(&mut n.composer);
        // Once no local revision is dirty or in flight, the daemon draft is
        // authoritative even if this composer was edited earlier in its life.
        // Offline dirty text is never replaced by a reconnect/bootstrap read.
        if !composer.draft_dirty && composer.draft_inflight_revision.is_none() {
            composer.text = bootstrap
                .draft
                .value
                .as_ref()
                .map_or_else(|| Arc::from(""), |draft| Arc::from(draft.text.as_str()));
            composer.draft_updated_at = bootstrap.draft.updated_at;
        }
        if composer.mode_save == OperationState::Idle {
            composer.mode = bootstrap.mode.clone();
        }
        confirm_pending_send(&mut n);
        self.store.set(n);
    }
    pub fn history_latest_reconcile(
        &mut self,
        cursor: impl Into<Arc<str>>,
        has_more: bool,
        runs: Vec<HistoryRun>,
    ) {
        let cursor = cursor.into();
        let cursor_omitted = cursor.len() > MAX_RETAINED_CURSOR_BYTES;
        let cursor = if cursor_omitted {
            Arc::from("")
        } else {
            cursor
        };
        let mut n = (*self.store.snapshot).clone();
        n.history_truncated |= cursor_omitted;
        let old_runs: Vec<_> = n
            .history_pages
            .iter()
            .flat_map(|p| p.runs.iter().cloned())
            .collect();
        let reconciled = reconcile_runs(&old_runs, runs);
        let latest_ids: BTreeSet<_> = reconciled.iter().map(|run| run.value.id.as_str()).collect();
        if !n.history_pages.is_empty() {
            let last = n.history_pages.len() - 1;
            for page in &mut n.history_pages[..last] {
                let retained: Vec<_> = page
                    .runs
                    .iter()
                    .filter(|run| !latest_ids.contains(run.value.id.as_str()))
                    .cloned()
                    .collect();
                if retained.len() != page.runs.len() {
                    *page = Arc::new(HistoryPage {
                        cursor: Arc::clone(&page.cursor),
                        has_more: page.has_more,
                        runs: retained,
                    });
                }
            }
            n.history_pages[last] = Arc::new(HistoryPage {
                cursor: Arc::clone(&cursor),
                has_more,
                runs: reconciled,
            });
        } else {
            n.history_pages.push(Arc::new(HistoryPage {
                cursor: Arc::clone(&cursor),
                has_more,
                runs: reconciled,
            }));
        }
        n.cursor = Some(cursor);
        n.history_truncated |= bound_history(&mut n.history_pages);
        n.has_more =
            !n.history_truncated && n.history_pages.first().is_some_and(|page| page.has_more);
        n.loading_older = false;
        n.older_error = n.history_truncated.then(history_omission_notice);
        confirm_pending_send(&mut n);
        self.store.set(n);
    }
    pub fn history_older_prepend(
        &mut self,
        cursor: impl Into<Arc<str>>,
        has_more: bool,
        runs: Vec<HistoryRun>,
    ) {
        let mut n = (*self.store.snapshot).clone();
        let old_runs: Vec<_> = n
            .history_pages
            .iter()
            .flat_map(|page| page.runs.iter().cloned())
            .collect();
        let existing_run_ids: BTreeSet<_> =
            old_runs.iter().map(|run| run.value.id.clone()).collect();
        let mut existing_message_ids: BTreeSet<String> = old_runs
            .iter()
            .flat_map(|run| run.messages.iter())
            .map(|message| message_id(message).to_owned())
            .collect();
        let mut admitted_run_ids = BTreeSet::new();
        let mut genuinely_older = Vec::new();
        for run in reconcile_runs(&old_runs, runs) {
            if existing_run_ids.contains(&run.value.id)
                || !admitted_run_ids.insert(run.value.id.clone())
            {
                continue;
            }
            let mut value = (*run).clone();
            value
                .messages
                .retain(|message| existing_message_ids.insert(message_id(message).to_owned()));
            genuinely_older.push(Arc::new(value));
        }

        if genuinely_older.is_empty() {
            // Event cursors can repeat across reads. No new run IDs means the
            // server made no paging progress, regardless of its `hasMore` bit.
            if let Some(first) = n.history_pages.first_mut() {
                Arc::make_mut(first).has_more = false;
            }
            n.has_more = false;
            n.loading_older = false;
            n.older_error = None;
            self.store.set(n);
            return;
        }

        let cursor = cursor.into();
        let cursor_omitted = cursor.len() > MAX_RETAINED_CURSOR_BYTES;
        n.history_truncated |= cursor_omitted;
        n.history_pages.insert(
            0,
            Arc::new(HistoryPage {
                // Cursor is delivery metadata only; page identity is run IDs.
                cursor: if cursor_omitted {
                    Arc::from("")
                } else {
                    cursor
                },
                has_more,
                runs: genuinely_older,
            }),
        );
        n.history_truncated |= bound_history(&mut n.history_pages);
        n.has_more =
            !n.history_truncated && n.history_pages.first().is_some_and(|page| page.has_more);
        n.loading_older = false;
        n.older_error = n.history_truncated.then(history_omission_notice);
        self.store.set(n);
    }
    pub fn history_older_failed(&mut self, message: impl Into<Arc<str>>) {
        let mut n = (*self.store.snapshot).clone();
        n.loading_older = false;
        n.older_error = Some(message.into());
        self.store.set(n);
    }
    pub fn question_reconcile(&mut self, value: Option<Question>) {
        let mut n = (*self.store.snapshot).clone();
        let previous_identity = n.question.as_ref().map(|question| {
            (
                question.id.as_str(),
                question
                    .questions
                    .iter()
                    .map(|prompt| prompt.id.as_str())
                    .collect::<Vec<_>>(),
            )
        });
        let next_identity = value.as_ref().map(|question| {
            (
                question.id.as_str(),
                question
                    .questions
                    .iter()
                    .map(|prompt| prompt.id.as_str())
                    .collect::<Vec<_>>(),
            )
        });
        let identity_changed = previous_identity != next_identity;
        n.question = reuse_option(n.question.as_ref(), value);
        if identity_changed || n.question.is_none() {
            Arc::make_mut(&mut n.composer).question_selections.clear();
        }
        self.store.set(n);
    }
    pub fn activity_reconcile(&mut self, processes: Vec<BackgroundProcess>, subagents: Vec<Agent>) {
        let mut n = (*self.store.snapshot).clone();
        n.processes = reuse_vec(&n.processes, &processes, |v| v.id.as_str());
        n.subagents = reuse_vec(&n.subagents, &subagents, |v| v.id.as_str());
        self.store.set(n);
    }
    pub fn refresh_started(&mut self, mutation: ChatMutationId) {
        let mut n = (*self.store.snapshot).clone();
        n.refresh = OperationState::Pending { mutation };
        self.store.set(n);
    }
    pub fn refresh_succeeded(&mut self) {
        let mut n = (*self.store.snapshot).clone();
        n.refresh = OperationState::Idle;
        self.store.set(n);
    }
    pub fn refresh_failed(&mut self, message: impl Into<Arc<str>>) {
        let mut n = (*self.store.snapshot).clone();
        n.refresh = OperationState::Failed {
            message: message.into(),
        };
        self.store.set(n);
    }
    pub fn draft_save_started(&mut self, mutation: ChatMutationId, revision: u64) {
        if self.store.snapshot.composer.revision == revision {
            self.composer_set(|composer| {
                composer.draft_inflight_revision = Some(revision);
                composer.draft_save = OperationState::Pending { mutation };
            });
        }
    }
    pub fn draft_save_succeeded(&mut self, revision: u64, saved: AgentDraftSnapshot) {
        if self.store.snapshot.composer.revision == revision {
            self.composer_set(|composer| {
                composer.text = saved
                    .value
                    .as_ref()
                    .map_or_else(|| Arc::from(""), |draft| Arc::from(draft.text.as_str()));
                composer.draft_updated_at = saved.updated_at;
                composer.draft_dirty = false;
                composer.draft_inflight_revision = None;
                composer.draft_save = OperationState::Idle;
            });
        }
    }
    pub fn draft_save_failed(&mut self, revision: u64, message: impl Into<Arc<str>>) {
        if self.store.snapshot.composer.revision == revision {
            let message = message.into();
            self.composer_set(|composer| {
                composer.draft_inflight_revision = None;
                composer.draft_dirty = true;
                composer.draft_save = OperationState::Failed { message };
            });
        }
    }
    pub fn mode_save_succeeded(
        &mut self,
        mutation: &ChatMutationId,
        revision: u64,
        saved: AgentDraftSnapshot,
        fallback: MessageMode,
    ) {
        let mode = saved
            .value
            .as_ref()
            .map(|draft| MessageMode {
                effort: draft.effort.clone(),
                model_id: draft.model_id.clone(),
                permission_mode: draft.permission_mode,
                provider_id: draft.provider_id.clone(),
                service_tier: draft.service_tier.clone(),
            })
            .unwrap_or(fallback);
        let mut n = (*self.store.snapshot).clone();
        n.mode = Some(mode.clone());
        let c = Arc::make_mut(&mut n.composer);
        let exact = matches!(
            &c.mode_save,
            OperationState::Pending { mutation: pending } if pending == mutation
        );
        if exact {
            c.mode = Some(mode);
            if c.revision == revision && !c.draft_dirty && c.draft_inflight_revision.is_none() {
                c.text = saved
                    .value
                    .as_ref()
                    .map_or_else(|| Arc::from(""), |draft| Arc::from(draft.text.as_str()));
                c.draft_updated_at = saved.updated_at;
            }
            c.mode_save = OperationState::Idle;
        }
        self.store.set(n);
    }
    pub fn mode_save_failed(&mut self, mutation: &ChatMutationId, message: impl Into<Arc<str>>) {
        if matches!(
            &self.store.snapshot.composer.mode_save,
            OperationState::Pending { mutation: pending } if pending == mutation
        ) {
            let message = message.into();
            self.composer_set(|composer| composer.mode_save = OperationState::Failed { message });
        }
    }
    pub fn message_send_succeeded(&mut self, message: UserMessage) {
        let mut n = (*self.store.snapshot).clone();
        let mut pending: Vec<UserMessage> = n
            .pending_user_messages
            .iter()
            .map(|value| value.as_ref().clone())
            .filter(|value| value.id != message.id)
            .collect();
        pending.push(message);
        let start = pending_user_start(&pending);
        n.pending_error = (start > 0).then(pending_omission_notice);
        n.pending_user_messages = reuse_vec(&n.pending_user_messages, &pending[start..], |v| {
            v.id.as_str()
        });
        let c = Arc::make_mut(&mut n.composer);
        if c.sending_revision == Some(c.revision) {
            c.text = Arc::from("");
            c.attachments.clear();
            c.revision += 1;
        }
        c.sending_revision = None;
        c.pending_send = None;
        c.message_send = OperationState::Idle;
        self.store.set(n);
    }
    pub fn message_send_failed(&mut self, message: impl Into<Arc<str>>) {
        if self.store.snapshot.composer.pending_send.is_none() {
            return;
        }
        let message = message.into();
        self.composer_set(|composer| {
            composer.message_send = OperationState::Failed { message };
        });
    }
    pub fn abort_succeeded(&mut self) {
        self.composer_set(|c| c.abort = OperationState::Idle);
    }
    pub fn abort_failed(&mut self, message: impl Into<Arc<str>>) {
        let m = message.into();
        self.composer_set(|c| c.abort = OperationState::Failed { message: m });
    }
    pub fn command_succeeded(&mut self) {
        self.composer_set(|c| {
            c.command = OperationState::Idle;
            c.selected_command = None;
            c.text = Arc::from("");
            c.revision += 1;
        });
    }
    pub fn command_failed(&mut self, message: impl Into<Arc<str>>) {
        let m = message.into();
        self.composer_set(|c| c.command = OperationState::Failed { message: m });
    }
    pub fn question_submit_succeeded(&mut self, question: Question) {
        let mut n = (*self.store.snapshot).clone();
        n.question = Some(Arc::new(question));
        let c = Arc::make_mut(&mut n.composer);
        c.question_submit = OperationState::Idle;
        c.question_selections.clear();
        self.store.set(n);
    }
    pub fn question_submit_failed(&mut self, message: impl Into<Arc<str>>) {
        let m = message.into();
        self.composer_set(|c| c.question_submit = OperationState::Failed { message: m });
    }
    pub fn attachment_failed(&mut self, id: &AttachmentId, message: impl Into<Arc<str>>) {
        let mut n = (*self.store.snapshot).clone();
        if let Some(i) = n.composer.attachments.iter().position(|a| &a.id == id) {
            let c = Arc::make_mut(&mut n.composer);
            let mut a = (*c.attachments[i]).clone();
            a.state = AttachmentState::Failed {
                message: message.into(),
            };
            c.attachments[i] = Arc::new(a);
            self.store.set(n);
        }
    }
    pub fn process_operation_succeeded(&mut self, id: &str) {
        let mut n = (*self.store.snapshot).clone();
        n.process_operations.remove(id);
        self.store.set(n);
    }
    pub fn process_operation_failed(
        &mut self,
        id: impl Into<Arc<str>>,
        message: impl Into<Arc<str>>,
    ) {
        let mut n = (*self.store.snapshot).clone();
        n.process_operations.insert(
            id.into(),
            OperationState::Failed {
                message: message.into(),
            },
        );
        self.store.set(n);
    }
    pub fn retry_succeeded(&mut self, id: &str) {
        let mut n = (*self.store.snapshot).clone();
        n.retry.remove(id);
        self.store.set(n);
    }
    pub fn retry_failed(&mut self, id: impl Into<Arc<str>>, message: impl Into<Arc<str>>) {
        let mut n = (*self.store.snapshot).clone();
        n.retry.insert(
            id.into(),
            OperationState::Failed {
                message: message.into(),
            },
        );
        self.store.set(n);
    }
    pub fn mark_read_succeeded(&mut self) {
        let mut n = (*self.store.snapshot).clone();
        n.mark_read = OperationState::Idle;
        self.store.set(n);
    }
    pub fn mark_read_failed(&mut self, message: impl Into<Arc<str>>) {
        let mut n = (*self.store.snapshot).clone();
        n.mark_read = OperationState::Failed {
            message: message.into(),
        };
        self.store.set(n);
    }
    fn composer_set(&mut self, f: impl FnOnce(&mut ComposerSnapshot)) {
        let mut n = (*self.store.snapshot).clone();
        f(Arc::make_mut(&mut n.composer));
        self.store.set(n);
    }
}

fn confirm_pending_send(snapshot: &mut ChatSnapshot) {
    let Some(pending) = snapshot.composer.pending_send.as_ref() else {
        return;
    };
    let id = pending.id.as_str();
    let confirmed = snapshot
        .pending_user_messages
        .iter()
        .any(|message| message.id == id)
        || snapshot.history_pages.iter().any(|page| {
            page.runs.iter().any(|run| {
                run.messages.iter().any(|message| match message.as_ref() {
                    Message::User(value) => value.id == id,
                    Message::Agent(_) | Message::System(_) | Message::Service(_) => false,
                })
            })
        });
    if !confirmed {
        return;
    }
    let composer = Arc::make_mut(&mut snapshot.composer);
    if composer.sending_revision == Some(composer.revision) {
        composer.text = Arc::from("");
        composer.attachments.clear();
        composer.revision += 1;
    }
    composer.sending_revision = None;
    composer.pending_send = None;
    composer.message_send = OperationState::Idle;
}

pub fn inline_image_mime_supported(value: &str) -> bool {
    matches!(
        value,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    )
}
fn pending_user_start(values: &[UserMessage]) -> usize {
    let count_start = values.len().saturating_sub(MAX_PENDING_USER_MESSAGES);
    let mut image_bytes = 0usize;
    let mut total_bytes = 0usize;
    let mut start = values.len();
    for (index, message) in values.iter().enumerate().rev() {
        if index < count_start {
            break;
        }
        let images = message
            .content
            .iter()
            .filter_map(|block| match block {
                MessageBlock::Image { data, .. } => Some(data.len()),
                _ => None,
            })
            .fold(0usize, usize::saturating_add);
        let payload = user_message_payload_bytes(message);
        if image_bytes.saturating_add(images) > MAX_PENDING_IMAGE_BASE64_BYTES
            || total_bytes.saturating_add(payload) > MAX_PENDING_TOTAL_PAYLOAD_BYTES
        {
            break;
        }
        image_bytes = image_bytes.saturating_add(images);
        total_bytes = total_bytes.saturating_add(payload);
        start = index;
    }
    start
}

fn user_message_payload_bytes(message: &UserMessage) -> usize {
    RETAINED_NODE_OVERHEAD
        .saturating_add(message.id.len())
        .saturating_add(metadata_bytes(&message.metadata))
        .saturating_add(message.profile.as_ref().map_or(0, String::len))
        .saturating_add(message.client_metadata.as_ref().map_or(0, json_map_bytes))
        .saturating_add(mode_bytes(&message.mode))
        .saturating_add(
            message
                .content
                .iter()
                .map(block_payload_bytes)
                .fold(0usize, usize::saturating_add),
        )
}

fn bound_history(pages: &mut Vec<Arc<HistoryPage>>) -> bool {
    let mut truncated = false;
    if pages.iter().any(|page| !page.runs.is_empty()) {
        let before = pages.len();
        pages.retain(|page| !page.runs.is_empty());
        truncated |= pages.len() != before;
    }
    while pages.len() > MAX_HISTORY_PAGES && history_run_count(pages) > 1 {
        let removable = pages
            .first()
            .map_or(0, |page| page.runs.len())
            .min(history_run_count(pages) - 1);
        if removable == 0 {
            pages.remove(0);
        } else if removable == pages[0].runs.len() {
            pages.remove(0);
        } else {
            Arc::make_mut(&mut pages[0]).runs.drain(..removable);
        }
        truncated = true;
    }

    while history_message_count(pages) > MAX_HISTORY_MESSAGES && history_run_count(pages) > 1 {
        let Some(page_index) = pages.iter().position(|page| !page.runs.is_empty()) else {
            break;
        };
        Arc::make_mut(&mut pages[page_index]).runs.remove(0);
        if pages[page_index].runs.is_empty() && pages.len() > 1 {
            pages.remove(page_index);
        }
        truncated = true;
    }

    while history_payload_bytes(pages) > MAX_HISTORY_TOTAL_PAYLOAD_BYTES
        && history_run_count(pages) > 1
    {
        let Some(page_index) = pages.iter().position(|page| !page.runs.is_empty()) else {
            break;
        };
        Arc::make_mut(&mut pages[page_index]).runs.remove(0);
        if pages[page_index].runs.is_empty() && pages.len() > 1 {
            pages.remove(page_index);
        }
        truncated = true;
    }

    while history_payload_bytes(pages) > MAX_HISTORY_TOTAL_PAYLOAD_BYTES
        && history_message_count(pages) > 1
    {
        if !remove_oldest_message(pages) {
            break;
        }
        truncated = true;
    }

    // A single very large run still keeps its stable run ID and newest message
    // window. It can never be removed into an empty transcript.
    if history_message_count(pages) > MAX_HISTORY_MESSAGES {
        if let Some((page_index, run_index)) = pages
            .iter()
            .enumerate()
            .find_map(|(page, value)| value.runs.iter().position(|_| true).map(|run| (page, run)))
        {
            let page = Arc::make_mut(&mut pages[page_index]);
            let run = Arc::make_mut(&mut page.runs[run_index]);
            let keep = MAX_HISTORY_MESSAGES.max(1);
            if run.messages.len() > keep {
                run.messages.drain(..run.messages.len() - keep);
                truncated = true;
            }
        }
    }

    // Preserve newest payloads within the total budget. Any older oversized
    // text, reasoning, tool JSON/output, diff, or image block becomes one
    // explicit notice per message without serialization/Debug allocation.
    truncated |= sanitize_history_payloads(pages);

    while history_payload_bytes(pages) > MAX_HISTORY_TOTAL_PAYLOAD_BYTES
        && history_message_count(pages) > 1
    {
        if !remove_oldest_message(pages) {
            break;
        }
        truncated = true;
    }
    if history_payload_bytes(pages) > MAX_HISTORY_TOTAL_PAYLOAD_BYTES {
        sanitize_sole_history_window(pages);
        truncated = true;
    }

    if truncated {
        if let Some(first) = pages.first_mut() {
            // Bounded retention intentionally terminates this paging window;
            // otherwise the same removed oldest run would be fetched forever.
            Arc::make_mut(first).has_more = false;
        }
    }
    truncated
}

fn history_run_count(pages: &[Arc<HistoryPage>]) -> usize {
    pages.iter().map(|page| page.runs.len()).sum()
}

fn history_message_count(pages: &[Arc<HistoryPage>]) -> usize {
    pages
        .iter()
        .flat_map(|page| page.runs.iter())
        .map(|run| run.messages.len())
        .sum()
}

fn remove_oldest_message(pages: &mut Vec<Arc<HistoryPage>>) -> bool {
    for page in pages {
        let page = Arc::make_mut(page);
        for run in &mut page.runs {
            let run = Arc::make_mut(run);
            if !run.messages.is_empty() {
                run.messages.remove(0);
                return true;
            }
        }
    }
    false
}

fn sanitize_history_payloads(pages: &mut Vec<Arc<HistoryPage>>) -> bool {
    let structural = pages
        .iter()
        .flat_map(|page| page.runs.iter())
        .map(|run| run_payload_base(run))
        .sum::<usize>();
    let mut remaining = MAX_HISTORY_TOTAL_PAYLOAD_BYTES.saturating_sub(structural);
    let mut omitted = false;
    for page in pages.iter_mut().rev() {
        let page = Arc::make_mut(page);
        for run in page.runs.iter_mut().rev() {
            let run = Arc::make_mut(run);
            for message in run.messages.iter_mut().rev() {
                let value = Arc::make_mut(message);
                let base = message_payload_base(value);
                remaining = remaining.saturating_sub(base);
                let blocks = message_blocks_mut(value);
                let mut keep = vec![false; blocks.len()];
                let mut message_omitted = false;
                for (index, block) in blocks.iter().enumerate().rev() {
                    let bytes = block_payload_bytes(block);
                    if bytes <= remaining {
                        remaining -= bytes;
                        keep[index] = true;
                    } else {
                        message_omitted = true;
                    }
                }
                if message_omitted {
                    let mut retained = Vec::with_capacity(
                        blocks.len().min(keep.iter().filter(|v| **v).count() + 1),
                    );
                    retained.push(MessageBlock::Text {
                        text: "[Older retained content omitted to limit memory]".to_owned(),
                    });
                    retained.extend(
                        std::mem::take(blocks)
                            .into_iter()
                            .enumerate()
                            .filter_map(|(index, block)| keep[index].then_some(block)),
                    );
                    *blocks = retained;
                    omitted = true;
                }
            }
        }
    }
    omitted
}

fn sanitize_sole_history_window(pages: &mut Vec<Arc<HistoryPage>>) {
    let Some(page) = pages.iter_mut().find(|page| !page.runs.is_empty()) else {
        return;
    };
    let page = Arc::make_mut(page);
    page.cursor = Arc::from("");
    let Some(run) = page.runs.first_mut() else {
        return;
    };
    let run = Arc::make_mut(run);
    Arc::make_mut(&mut run.value).usage.clear();
    let Some(message) = run.messages.last_mut() else {
        return;
    };
    let value = Arc::make_mut(message);
    match value {
        Message::User(value) => {
            value.client_metadata = None;
            value.profile = None;
            value.metadata = Default::default();
            value.mode.effort.clear();
            value.mode.model_id.clear();
            value.mode.provider_id.clear();
            value.mode.service_tier = None;
        }
        Message::Agent(value) | Message::System(value) | Message::Service(value) => {
            value.metadata = Default::default();
        }
    }
    *message_blocks_mut(value) = vec![MessageBlock::Text {
        text: "[Retained message content omitted to limit memory]".to_owned(),
    }];
}

fn history_payload_bytes(pages: &[Arc<HistoryPage>]) -> usize {
    pages.iter().fold(0usize, |total, page| {
        total
            .saturating_add(RETAINED_NODE_OVERHEAD)
            .saturating_add(page.cursor.len())
            .saturating_add(page.runs.iter().fold(0usize, |runs, run| {
                runs.saturating_add(run_payload_base(run))
                    .saturating_add(run.messages.iter().fold(0usize, |messages, message| {
                        messages
                            .saturating_add(message_payload_base(message))
                            .saturating_add(
                                message_blocks(message)
                                    .iter()
                                    .fold(0usize, |blocks, block| {
                                        blocks.saturating_add(block_payload_bytes(block))
                                    }),
                            )
                    }))
            }))
    })
}

fn run_payload_base(run: &ChatRun) -> usize {
    RETAINED_NODE_OVERHEAD
        .saturating_add(run.value.id.len())
        .saturating_add(run.value.usage.iter().fold(
            RETAINED_NODE_OVERHEAD,
            |providers, (provider, models)| {
                providers
                    .saturating_add(RETAINED_NODE_OVERHEAD)
                    .saturating_add(provider.len())
                    .saturating_add(models.keys().fold(0usize, |total, model| {
                        total
                            .saturating_add(RETAINED_NODE_OVERHEAD)
                            .saturating_add(model.len())
                    }))
            },
        ))
}

fn message_payload_base(message: &Message) -> usize {
    let base = RETAINED_NODE_OVERHEAD;
    match message {
        Message::User(value) => base
            .saturating_add(value.id.len())
            .saturating_add(metadata_bytes(&value.metadata))
            .saturating_add(value.profile.as_ref().map_or(0, String::len))
            .saturating_add(value.client_metadata.as_ref().map_or(0, json_map_bytes))
            .saturating_add(mode_bytes(&value.mode)),
        Message::Agent(value) | Message::System(value) | Message::Service(value) => base
            .saturating_add(value.id.len())
            .saturating_add(metadata_bytes(&value.metadata)),
    }
}

fn metadata_bytes(value: &crate::connectivity::chat_protocol::MessageMetadata) -> usize {
    RETAINED_NODE_OVERHEAD
        .saturating_add(value.provider_id.as_ref().map_or(0, String::len))
        .saturating_add(value.model_id.as_ref().map_or(0, String::len))
        .saturating_add(value.sender_agent_id.as_ref().map_or(0, String::len))
}

fn mode_bytes(value: &MessageMode) -> usize {
    RETAINED_NODE_OVERHEAD
        .saturating_add(value.effort.len())
        .saturating_add(value.model_id.len())
        .saturating_add(value.provider_id.len())
        .saturating_add(value.service_tier.as_ref().map_or(0, String::len))
}

fn block_payload_bytes(block: &MessageBlock) -> usize {
    use crate::connectivity::chat_protocol::{
        CompactionBlock, ExplorationOperation, ToolPermissionReview, ToolPresentation,
    };
    let payload = match block {
        MessageBlock::Text { text } | MessageBlock::Reasoning { text } => text.len(),
        MessageBlock::Image { mime_type, data } => mime_type.len().saturating_add(data.len()),
        MessageBlock::ToolCallRequest { name, arguments } => {
            name.len().saturating_add(json_map_bytes(arguments))
        }
        MessageBlock::ToolCall(tool) => tool
            .id
            .len()
            .saturating_add(tool.name.len())
            .saturating_add(tool.arguments.as_ref().map_or(0, json_map_bytes))
            .saturating_add(tool.result.as_ref().map_or(0, json_map_bytes))
            .saturating_add(tool.presentation.as_ref().map_or(0, |presentation| {
                RETAINED_NODE_OVERHEAD.saturating_add(match presentation {
                    ToolPresentation::Exploration { operations } => {
                        operations
                            .iter()
                            .fold(RETAINED_NODE_OVERHEAD, |total, operation| {
                                total.saturating_add(RETAINED_NODE_OVERHEAD).saturating_add(
                                    match operation {
                                        ExplorationOperation::List { target } => target.len(),
                                        ExplorationOperation::Read { name } => name.len(),
                                        ExplorationOperation::Search {
                                            command,
                                            path,
                                            query,
                                        } => command
                                            .len()
                                            .saturating_add(path.as_ref().map_or(0, String::len))
                                            .saturating_add(query.as_ref().map_or(0, String::len)),
                                    },
                                )
                            })
                    }
                    ToolPresentation::ExecCommand {
                        command,
                        output,
                        terminal_id,
                    } => command
                        .len()
                        .saturating_add(output.as_ref().map_or(0, String::len))
                        .saturating_add(terminal_id.as_ref().map_or(0, String::len)),
                    ToolPresentation::BackgroundTerminalInteraction {
                        command,
                        input,
                        terminal_id,
                    } => command
                        .len()
                        .saturating_add(input.len())
                        .saturating_add(terminal_id.len()),
                    ToolPresentation::FileDiff { files, .. } => {
                        files.iter().fold(RETAINED_NODE_OVERHEAD, |total, file| {
                            total
                                .saturating_add(RETAINED_NODE_OVERHEAD)
                                .saturating_add(file.path.len())
                                .saturating_add(file.language.as_ref().map_or(0, String::len))
                                .saturating_add(file.hunks.iter().fold(
                                    RETAINED_NODE_OVERHEAD,
                                    |hunks, hunk| {
                                        hunks.saturating_add(RETAINED_NODE_OVERHEAD).saturating_add(
                                            hunk.lines.iter().fold(0usize, |lines, line| {
                                                lines
                                                    .saturating_add(RETAINED_NODE_OVERHEAD)
                                                    .saturating_add(line.text.len())
                                            }),
                                        )
                                    },
                                ))
                        })
                    }
                    ToolPresentation::Search { query, sources, .. } => {
                        query
                            .len()
                            .saturating_add(sources.as_ref().map_or(0, |sources| {
                                sources
                                    .iter()
                                    .fold(RETAINED_NODE_OVERHEAD, |total, source| {
                                        total
                                            .saturating_add(RETAINED_NODE_OVERHEAD)
                                            .saturating_add(source.title.len())
                                            .saturating_add(source.url.len())
                                    })
                            }))
                    }
                })
            }))
            .saturating_add(tool.review.as_ref().map_or(0, |review| {
                RETAINED_NODE_OVERHEAD.saturating_add(match review {
                    ToolPermissionReview::Allowed { reason, .. }
                    | ToolPermissionReview::Denied { reason, .. }
                    | ToolPermissionReview::Unproven { reason, .. } => reason.len(),
                })
            })),
        MessageBlock::Compaction(value) => match value {
            CompactionBlock::Failed { failure_reason, .. } => failure_reason.len(),
            CompactionBlock::Running { .. } | CompactionBlock::Completed { .. } => 0,
        },
    };
    RETAINED_NODE_OVERHEAD.saturating_add(payload)
}

fn json_map_bytes(values: &BTreeMap<String, serde_json::Value>) -> usize {
    values
        .iter()
        .fold(RETAINED_NODE_OVERHEAD, |total, (key, value)| {
            total
                .saturating_add(RETAINED_NODE_OVERHEAD)
                .saturating_add(key.len())
                .saturating_add(json_value_bytes(value))
        })
}

fn json_value_bytes(value: &serde_json::Value) -> usize {
    RETAINED_NODE_OVERHEAD.saturating_add(match value {
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => 16,
        serde_json::Value::String(value) => value.len(),
        serde_json::Value::Array(values) => values.iter().fold(0usize, |total, value| {
            total.saturating_add(json_value_bytes(value))
        }),
        serde_json::Value::Object(values) => values.iter().fold(0usize, |total, (key, value)| {
            total
                .saturating_add(RETAINED_NODE_OVERHEAD)
                .saturating_add(key.len())
                .saturating_add(json_value_bytes(value))
        }),
    })
}

fn message_blocks_mut(message: &mut Message) -> &mut Vec<MessageBlock> {
    match message {
        Message::User(value) => &mut value.content,
        Message::Agent(value) | Message::System(value) | Message::Service(value) => {
            &mut value.content
        }
    }
}

fn pending_omission_notice() -> Arc<str> {
    Arc::from("Some pending message content was omitted to limit memory.")
}

fn history_omission_notice() -> Arc<str> {
    Arc::from("Some older messages or image payloads were omitted to limit memory.")
}

fn message_blocks(message: &Arc<Message>) -> &[MessageBlock] {
    match message.as_ref() {
        Message::User(value) => &value.content,
        Message::Agent(value) | Message::System(value) | Message::Service(value) => &value.content,
    }
}

fn truncate_utf8(value: Arc<str>, limit: usize) -> Arc<str> {
    if value.len() <= limit {
        return value;
    }
    let mut end = limit;
    while !value.is_char_boundary(end) {
        end -= 1
    }
    Arc::from(&value[..end])
}
fn arc_reuse<T: PartialEq>(old: Option<&Arc<T>>, value: T) -> Arc<T> {
    old.filter(|v| v.as_ref() == &value)
        .cloned()
        .unwrap_or_else(|| Arc::new(value))
}
fn reuse_option<T: PartialEq>(old: Option<&Arc<T>>, value: Option<T>) -> Option<Arc<T>> {
    value.map(|v| arc_reuse(old, v))
}
fn reuse_vec<T: PartialEq + Clone>(
    old: &[Arc<T>],
    values: &[T],
    id: impl Fn(&T) -> &str,
) -> Vec<Arc<T>> {
    let by_id: BTreeMap<&str, &Arc<T>> = old.iter().map(|v| (id(v), v)).collect();
    values
        .iter()
        .map(|v| arc_reuse(by_id.get(id(v)).copied(), v.clone()))
        .collect()
}
fn reconcile_runs(old: &[Arc<ChatRun>], values: Vec<HistoryRun>) -> Vec<Arc<ChatRun>> {
    let by_id: BTreeMap<&str, &Arc<ChatRun>> =
        old.iter().map(|r| (r.value.id.as_str(), r)).collect();
    values
        .into_iter()
        .map(|mut run| {
            let previous = by_id.get(run.id.as_str()).copied();
            let old_messages = previous.map_or(&[][..], |r| r.messages.as_slice());
            let messages = reuse_vec(old_messages, &run.messages, message_id);
            // `ChatRun` owns the Arc message collection. Clear the protocol
            // envelope's copy so inline image data is not retained twice.
            run.messages.clear();
            if let Some(old) = previous
                && old.value.as_ref() == &run
                && old.messages.len() == messages.len()
                && old
                    .messages
                    .iter()
                    .zip(&messages)
                    .all(|(left, right)| Arc::ptr_eq(left, right))
            {
                return Arc::clone(old);
            }
            Arc::new(ChatRun {
                value: Arc::new(run),
                messages,
            })
        })
        .collect()
}
fn message_id(value: &Message) -> &str {
    match value {
        Message::User(v) => &v.id,
        Message::Agent(v) | Message::System(v) | Message::Service(v) => &v.id,
    }
}
