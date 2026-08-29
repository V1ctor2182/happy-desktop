use serde::Deserialize;
use std::sync::Arc;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct DaemonVersion {
    pub daemon: String,
    pub protocol: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct HealthSnapshot {
    pub healthy: bool,
    pub ready: bool,
    pub status: DaemonStatus,
    pub version: DaemonVersion,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DaemonStatus {
    Starting,
    Ready,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct AgentSnapshot {
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<i64>,
    pub id: String,
    #[serde(rename = "orderKey")]
    pub order_key: Option<String>,
    pub title: Option<String>,
    pub status: AgentStatus,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Thinking,
    Working,
    GeneratingTools,
    RunningTools,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct ProjectSnapshot {
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<i64>,
    pub id: String,
    pub name: String,
    #[serde(rename = "orderKey")]
    pub order_key: String,
    pub status: CatalogStatus,
    #[serde(default)]
    pub agents: Vec<AgentSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct WorkspaceSnapshot {
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<i64>,
    #[serde(default)]
    pub agents: Vec<AgentSnapshot>,
    pub id: String,
    pub name: String,
    #[serde(rename = "orderKey")]
    pub order_key: String,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    pub status: CatalogStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CatalogStatus {
    Active,
    Archiving,
    Archived,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct BootstrapSnapshot {
    pub cursor: String,
    pub projects: Vec<ProjectSnapshot>,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceSnapshot>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConnectionState {
    Connecting,
    Online,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeSnapshot {
    pub connection: ConnectionState,
    pub message: Arc<str>,
    pub projects: Arc<[ProjectSnapshot]>,
    pub workspaces: Arc<[WorkspaceSnapshot]>,
}

impl RuntimeSnapshot {
    pub fn connecting() -> Self {
        Self {
            connection: ConnectionState::Connecting,
            message: Arc::from("Connecting to your local Happy Agent…"),
            projects: Arc::from([]),
            workspaces: Arc::from([]),
        }
    }

    pub fn online(bootstrap: BootstrapSnapshot) -> Self {
        let mut active = bootstrap
            .projects
            .into_iter()
            .filter(|project| {
                project.status == CatalogStatus::Active && project.archived_at.is_none()
            })
            .collect::<Vec<_>>();
        active.sort_by(|left, right| left.order_key.cmp(&right.order_key));
        for project in &mut active {
            project.agents.retain(|agent| agent.archived_at.is_none());
            project
                .agents
                .sort_by(|left, right| left.order_key.cmp(&right.order_key));
        }
        let mut workspaces = bootstrap
            .workspaces
            .into_iter()
            .filter(|workspace| {
                workspace.status == CatalogStatus::Active && workspace.archived_at.is_none()
            })
            .collect::<Vec<_>>();
        workspaces.sort_by(|left, right| left.order_key.cmp(&right.order_key));
        for workspace in &mut workspaces {
            workspace.agents.retain(|agent| agent.archived_at.is_none());
            workspace
                .agents
                .sort_by(|left, right| left.order_key.cmp(&right.order_key));
        }
        Self {
            connection: ConnectionState::Online,
            message: Arc::from(format!("Online · {} projects", active.len())),
            projects: active.into(),
            workspaces: workspaces.into(),
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            connection: ConnectionState::Error,
            message: Arc::from(message),
            projects: Arc::from([]),
            workspaces: Arc::from([]),
        }
    }

    pub fn fixture() -> Self {
        Self {
            connection: ConnectionState::Online,
            message: Arc::from("Online · fixture"),
            projects: Arc::from([]),
            workspaces: Arc::from([]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_projection_keeps_only_server_confirmed_active_projects() {
        let bootstrap: BootstrapSnapshot = serde_json::from_str(
            r#"{
                "cursor":"0009",
                "projects":[
                    {"archivedAt":null,"id":"p1","name":"Happy","orderKey":"a","status":"active","agents":[]},
                    {"archivedAt":1,"id":"p2","name":"Old","orderKey":"b","status":"archived","agents":[]}
                ],
                "workspaces":[]
            }"#,
        )
        .unwrap();
        let snapshot = RuntimeSnapshot::online(bootstrap);
        assert_eq!(snapshot.connection, ConnectionState::Online);
        assert_eq!(snapshot.projects.len(), 1);
        assert_eq!(snapshot.projects[0].name, "Happy");
        assert_eq!(&*snapshot.message, "Online · 1 projects");
    }

    #[test]
    fn malformed_owned_fields_are_rejected_instead_of_guessed() {
        let malformed = r#"{"cursor":"1","projects":[{"archivedAt":null,"id":"p","name":"P","orderKey":"a","status":"unknown"}],"workspaces":[]}"#;
        assert!(serde_json::from_str::<BootstrapSnapshot>(malformed).is_err());
    }
}
