//! Pure transcript projection for the focused conversation store.
//!
//! Rows have closed kinds and stable product IDs. This module contains no GPUI,
//! DOM, or other framework API.

use std::sync::Arc;

use crate::connectivity::{
    AgentStatus,
    chat_protocol::{
        BackgroundProcessStatus, CompactionBlock, Message, MessageBlock, QuestionStatus, RunStatus,
        ToolCallBlock, ToolPermissionReview,
    },
};

use super::store::ChatSnapshot;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ChatTranscriptRowId {
    Message(Arc<str>),
    Block { message_id: Arc<str>, index: usize },
    Tool(Arc<str>),
    Review(Arc<str>),
    Compaction { message_id: Arc<str>, index: usize },
    Question(Arc<str>),
    Subagent(Arc<str>),
    Process(Arc<str>),
    RunStatus(Arc<str>),
    ConversationStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatTranscriptMessageRole {
    User,
    Agent,
    System,
    Service,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatTranscriptBlockKind {
    Text,
    Image,
    Reasoning,
    ToolCallRequest,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ChatTranscriptRowKind {
    Message {
        role: ChatTranscriptMessageRole,
        message: Arc<Message>,
    },
    Block {
        role: ChatTranscriptMessageRole,
        kind: ChatTranscriptBlockKind,
        message_id: Arc<str>,
        block_index: usize,
        block: Arc<MessageBlock>,
    },
    Tool {
        message_id: Arc<str>,
        block_index: usize,
        tool: Arc<ToolCallBlock>,
    },
    Review {
        tool_id: Arc<str>,
        review: Arc<ToolPermissionReview>,
    },
    Compaction {
        message_id: Arc<str>,
        block_index: usize,
        compaction: Arc<CompactionBlock>,
    },
    Question {
        question_id: Arc<str>,
        status: QuestionStatus,
    },
    Subagent {
        agent_id: Arc<str>,
        status: AgentStatus,
        title: Option<Arc<str>>,
    },
    Process {
        process_id: Arc<str>,
        command: Arc<str>,
        status: BackgroundProcessStatus,
        exit_code: Option<i64>,
    },
    RunStatus {
        run_id: Arc<str>,
        status: RunStatus,
    },
    ConversationStatus {
        load: super::store::LoadState,
        availability: super::store::AgentAvailability,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChatTranscriptRow {
    pub id: ChatTranscriptRowId,
    pub created_at: Option<i64>,
    pub kind: ChatTranscriptRowKind,
}

pub fn transcript_project(snapshot: &ChatSnapshot) -> Vec<Arc<ChatTranscriptRow>> {
    let mut rows = Vec::new();

    for page in &snapshot.history_pages {
        for run in &page.runs {
            for message in &run.messages {
                project_message(&mut rows, message);
            }
            rows.push(Arc::new(ChatTranscriptRow {
                id: ChatTranscriptRowId::RunStatus(Arc::from(run.value.id.as_str())),
                created_at: run.value.ended_at.or(Some(run.value.started_at)),
                kind: ChatTranscriptRowKind::RunStatus {
                    run_id: Arc::from(run.value.id.as_str()),
                    status: run.value.status,
                },
            }));
        }
    }

    // Pending messages are not duplicated if the same authoritative message is
    // already present in a history page.
    for message in &snapshot.pending_user_messages {
        if !rows
            .iter()
            .any(|row| row.id == ChatTranscriptRowId::Message(Arc::from(message.id.as_str())))
        {
            let message = Arc::new(Message::User(
                crate::connectivity::chat_protocol::UserMessageFields {
                    id: message.id.clone(),
                    created_at: message.created_at,
                    content: message.content.clone(),
                    metadata: message.metadata.clone(),
                    client_metadata: message.client_metadata.clone(),
                    profile: message.profile.clone(),
                    status: message.status,
                    delivery: message.delivery,
                    mode: message.mode.clone(),
                    run_id: message.run_id.clone(),
                },
            ));
            project_message(&mut rows, &message);
        }
    }

    if let Some(question) = &snapshot.question {
        rows.push(Arc::new(ChatTranscriptRow {
            id: ChatTranscriptRowId::Question(Arc::from(question.id.as_str())),
            created_at: Some(question.created_at),
            kind: ChatTranscriptRowKind::Question {
                question_id: Arc::from(question.id.as_str()),
                status: question.status,
            },
        }));
    }
    for agent in &snapshot.subagents {
        rows.push(Arc::new(ChatTranscriptRow {
            id: ChatTranscriptRowId::Subagent(Arc::from(agent.id.as_str())),
            created_at: Some(agent.created_at),
            kind: ChatTranscriptRowKind::Subagent {
                agent_id: Arc::from(agent.id.as_str()),
                status: agent.status.clone(),
                title: agent.title.as_deref().map(Arc::from),
            },
        }));
    }
    for process in &snapshot.processes {
        rows.push(Arc::new(ChatTranscriptRow {
            id: ChatTranscriptRowId::Process(Arc::from(process.id.as_str())),
            created_at: Some(process.started_at),
            kind: ChatTranscriptRowKind::Process {
                process_id: Arc::from(process.id.as_str()),
                command: Arc::from(process.command.as_str()),
                status: process.status,
                exit_code: process.exit_code,
            },
        }));
    }
    // Merge every timestamped authoritative entity into one chronology.
    // The original authoritative projection order is the deterministic stable
    // tie-breaker for equal timestamps, preserving message/block/run grouping.
    let mut ordered: Vec<_> = rows.into_iter().enumerate().collect();
    ordered.sort_by_key(|(ordinal, row)| (row.created_at.unwrap_or(i64::MAX), *ordinal));
    let mut rows: Vec<_> = ordered.into_iter().map(|(_, row)| row).collect();

    rows.push(Arc::new(ChatTranscriptRow {
        id: ChatTranscriptRowId::ConversationStatus,
        created_at: None,
        kind: ChatTranscriptRowKind::ConversationStatus {
            load: snapshot.load.clone(),
            availability: snapshot.availability.clone(),
        },
    }));
    rows
}

fn project_message(rows: &mut Vec<Arc<ChatTranscriptRow>>, message: &Arc<Message>) {
    let (id, created_at, role) = match message.as_ref() {
        Message::User(v) => (v.id.as_str(), v.created_at, ChatTranscriptMessageRole::User),
        Message::Agent(v) => (
            v.id.as_str(),
            v.created_at,
            ChatTranscriptMessageRole::Agent,
        ),
        Message::System(v) => (
            v.id.as_str(),
            v.created_at,
            ChatTranscriptMessageRole::System,
        ),
        Message::Service(v) => (
            v.id.as_str(),
            v.created_at,
            ChatTranscriptMessageRole::Service,
        ),
    };
    let message_id: Arc<str> = Arc::from(id);
    rows.push(Arc::new(ChatTranscriptRow {
        id: ChatTranscriptRowId::Message(Arc::clone(&message_id)),
        created_at: Some(created_at),
        kind: ChatTranscriptRowKind::Message {
            role,
            message: Arc::clone(message),
        },
    }));
    let content = match message.as_ref() {
        Message::User(value) => &value.content,
        Message::Agent(value) => &value.content,
        Message::System(value) => &value.content,
        Message::Service(value) => &value.content,
    };
    for (block_index, block) in content.iter().enumerate() {
        match block {
            MessageBlock::ToolCall(tool) => {
                let tool = Arc::new(tool.clone());
                let tool_id: Arc<str> = Arc::from(tool.id.as_str());
                rows.push(Arc::new(ChatTranscriptRow {
                    id: ChatTranscriptRowId::Tool(Arc::clone(&tool_id)),
                    created_at: Some(created_at),
                    kind: ChatTranscriptRowKind::Tool {
                        message_id: Arc::clone(&message_id),
                        block_index,
                        tool: Arc::clone(&tool),
                    },
                }));
                if let Some(review) = tool.review.as_ref() {
                    rows.push(Arc::new(ChatTranscriptRow {
                        id: ChatTranscriptRowId::Review(Arc::clone(&tool_id)),
                        created_at: Some(created_at),
                        kind: ChatTranscriptRowKind::Review {
                            tool_id,
                            review: Arc::new(review.clone()),
                        },
                    }));
                }
            }
            MessageBlock::Compaction(compaction) => {
                rows.push(Arc::new(ChatTranscriptRow {
                    id: ChatTranscriptRowId::Compaction {
                        message_id: Arc::clone(&message_id),
                        index: block_index,
                    },
                    created_at: Some(created_at),
                    kind: ChatTranscriptRowKind::Compaction {
                        message_id: Arc::clone(&message_id),
                        block_index,
                        compaction: Arc::new(compaction.clone()),
                    },
                }));
            }
            MessageBlock::ToolCallRequest { .. } => {
                rows.push(Arc::new(ChatTranscriptRow {
                    id: ChatTranscriptRowId::Block {
                        message_id: Arc::clone(&message_id),
                        index: block_index,
                    },
                    created_at: Some(created_at),
                    kind: ChatTranscriptRowKind::Block {
                        role,
                        kind: ChatTranscriptBlockKind::ToolCallRequest,
                        message_id: Arc::clone(&message_id),
                        block_index,
                        block: Arc::new(block.clone()),
                    },
                }));
            }
            MessageBlock::Text { .. }
            | MessageBlock::Image { .. }
            | MessageBlock::Reasoning { .. } => {}
        }
    }
}
