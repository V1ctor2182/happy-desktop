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
    pub id: String,
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
    pub id: String,
    pub name: String,
    pub status: CatalogStatus,
    #[serde(default)]
    pub agents: Vec<AgentSnapshot>,
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
}

impl RuntimeSnapshot {
    pub fn connecting() -> Self {
        Self {
            connection: ConnectionState::Connecting,
            message: Arc::from("Connecting to your local Happy Agent…"),
            projects: Arc::from([]),
        }
    }

    pub fn online(bootstrap: BootstrapSnapshot) -> Self {
        let active = bootstrap
            .projects
            .into_iter()
            .filter(|project| project.status == CatalogStatus::Active)
            .collect::<Vec<_>>();
        Self {
            connection: ConnectionState::Online,
            message: Arc::from(format!("Online · {} projects", active.len())),
            projects: active.into(),
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            connection: ConnectionState::Error,
            message: Arc::from(message),
            projects: Arc::from([]),
        }
    }

    pub fn fixture() -> Self {
        Self {
            connection: ConnectionState::Online,
            message: Arc::from("Online · fixture"),
            projects: Arc::from([]),
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
                    {"id":"p1","name":"Happy","status":"active","agents":[]},
                    {"id":"p2","name":"Old","status":"archived","agents":[]}
                ]
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
        let malformed = r#"{"cursor":"1","projects":[{"id":"p","name":"P","status":"unknown"}]}"#;
        assert!(serde_json::from_str::<BootstrapSnapshot>(malformed).is_err());
    }
}
