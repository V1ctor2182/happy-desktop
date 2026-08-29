use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Arc;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct AgentConversationBootstrap {
    pub cursor: String,
    pub pending: Vec<WireMessage>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MessageHistory {
    pub cursor: String,
    pub has_more: bool,
    pub runs: Vec<HistoryRun>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct HistoryRun {
    pub id: String,
    pub messages: Vec<WireMessage>,
    pub status: RunStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Completed,
    Aborted,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WireMessage {
    pub content: Vec<MessageBlock>,
    pub created_at: i64,
    pub id: String,
    pub role: MessageRole,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    User,
    Agent,
    System,
    Service,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessageBlock {
    Text {
        text: String,
    },
    Image {
        #[serde(rename = "mimeType")]
        mime_type: String,
        data: String,
    },
    ToolCallRequest {
        name: String,
    },
    Reasoning {
        text: String,
    },
    ToolCall {
        id: String,
        name: String,
        status: ToolStatus,
    },
    Compaction {
        status: CompactionStatus,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CompactionStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConversationRow {
    Message {
        id: Arc<str>,
        author: &'static str,
        body: Arc<str>,
        user: bool,
    },
    Activity {
        id: Arc<str>,
        label: Arc<str>,
        detail: Arc<str>,
    },
}

impl ConversationRow {
    pub fn id(&self) -> &str {
        match self {
            Self::Message { id, .. } | Self::Activity { id, .. } => id,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConversationSnapshot {
    pub agent_id: Arc<str>,
    pub has_more: bool,
    pub rows: Arc<[ConversationRow]>,
}

impl ConversationSnapshot {
    pub fn project(
        agent_id: String,
        history: MessageHistory,
        bootstrap: AgentConversationBootstrap,
    ) -> Self {
        let mut messages = history
            .runs
            .into_iter()
            .flat_map(|run| run.messages)
            .collect::<Vec<_>>();
        let mut ids = messages
            .iter()
            .map(|message| message.id.clone())
            .collect::<HashSet<_>>();
        messages.extend(
            bootstrap
                .pending
                .iter()
                .filter(|message| ids.insert(message.id.clone()))
                .cloned(),
        );
        let rows = messages
            .into_iter()
            .flat_map(project_message)
            .collect::<Vec<_>>();
        Self {
            agent_id: Arc::from(agent_id),
            has_more: history.has_more,
            rows: rows.into(),
        }
    }
}

fn project_message(message: WireMessage) -> Vec<ConversationRow> {
    let (author, user) = match message.role {
        MessageRole::User => ("You", true),
        MessageRole::Agent => ("Happy Agent", false),
        MessageRole::System => ("System", false),
        MessageRole::Service => ("Happy Agent", false),
    };
    let text = message
        .content
        .iter()
        .filter_map(|block| match block {
            MessageBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    let mut rows = Vec::new();
    if !text.is_empty() {
        rows.push(ConversationRow::Message {
            id: Arc::from(message.id.clone()),
            author,
            body: Arc::from(text),
            user,
        });
    }
    for (index, block) in message.content.into_iter().enumerate() {
        let row_id = Arc::from(format!("{}:{index}", message.id));
        match block {
            MessageBlock::Text { .. } => {}
            MessageBlock::Image { mime_type, .. } => rows.push(ConversationRow::Activity {
                id: row_id,
                label: Arc::from("Image"),
                detail: Arc::from(mime_type),
            }),
            MessageBlock::ToolCallRequest { name } => rows.push(ConversationRow::Activity {
                id: row_id,
                label: Arc::from("Requested tool"),
                detail: Arc::from(name),
            }),
            MessageBlock::Reasoning { text } => rows.push(ConversationRow::Activity {
                id: row_id,
                label: Arc::from("Reasoning"),
                detail: Arc::from(text),
            }),
            MessageBlock::ToolCall { name, status, .. } => {
                rows.push(ConversationRow::Activity {
                    id: row_id,
                    label: Arc::from(name),
                    detail: Arc::from(match status {
                        ToolStatus::Running => "Running",
                        ToolStatus::Completed => "Completed",
                        ToolStatus::Failed => "Failed",
                    }),
                });
            }
            MessageBlock::Compaction { status } => rows.push(ConversationRow::Activity {
                id: row_id,
                label: Arc::from("Compaction"),
                detail: Arc::from(match status {
                    CompactionStatus::Running => "Running",
                    CompactionStatus::Completed => "Completed",
                    CompactionStatus::Failed => "Failed",
                }),
            }),
        }
    }
    rows
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConversationState {
    Fixture,
    Empty,
    Loading,
    Ready(Arc<ConversationSnapshot>),
    Error(Arc<str>),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_history_projects_text_tools_and_unique_pending_messages_in_wire_order() {
        let history: MessageHistory = serde_json::from_str(
            r#"{"cursor":"10","hasMore":false,"runs":[{"id":"r1","status":"completed","messages":[{"id":"m1","role":"user","createdAt":1,"content":[{"type":"text","text":"Build it"}]}]}]}"#,
        )
        .unwrap();
        let bootstrap: AgentConversationBootstrap = serde_json::from_str(
            r#"{"cursor":"11","pending":[{"id":"m2","role":"agent","createdAt":2,"content":[{"type":"text","text":"Working"},{"type":"tool_call","id":"t1","name":"Read","status":"running"}]}]}"#,
        )
        .unwrap();
        let snapshot = ConversationSnapshot::project("a1".to_owned(), history, bootstrap);
        assert_eq!(snapshot.rows.len(), 3);
        assert_eq!(snapshot.rows[0].id(), "m1");
        assert_eq!(snapshot.rows[1].id(), "m2");
        assert_eq!(snapshot.rows[2].id(), "m2:1");
    }

    #[test]
    fn unknown_owned_message_blocks_are_rejected() {
        let value =
            r#"{"id":"m","role":"agent","createdAt":1,"content":[{"type":"guess","text":"no"}]}"#;
        assert!(serde_json::from_str::<WireMessage>(value).is_err());
    }
}
