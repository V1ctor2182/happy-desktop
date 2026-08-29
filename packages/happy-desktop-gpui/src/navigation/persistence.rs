use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use super::{FileKind, FilePath, GroupId, Route, SessionId, SettingsSection};
use crate::connectivity::AgentNamespace;

const DOCUMENT_VERSION: u32 = 1;

/// Durable storage owned by one native window's navigation history.
///
/// The path can be configured by the application, but writes stay private to
/// the history module. A write uses a sibling temporary file, `fsync`, atomic
/// rename, and a directory `fsync`; a crash yields either complete version.
pub struct HistoryPersistence {
    path: PathBuf,
}

impl HistoryPersistence {
    pub fn open(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
            }
        }
        Ok(Self { path })
    }

    pub(crate) fn read(
        &self,
        resolve_agent: &impl Fn(&str) -> Option<AgentNamespace>,
    ) -> io::Result<Option<(Vec<Route>, usize)>> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let Ok(document) = serde_json::from_slice::<StoredDocument>(&bytes) else {
            return Ok(None);
        };
        if document.version != DOCUMENT_VERSION || document.entries.is_empty() {
            return Ok(None);
        }

        let stored_index = document.index.min(document.entries.len() - 1);
        let mut entries = Vec::new();
        let mut index = 0;
        for (position, value) in document.entries.into_iter().enumerate() {
            let Ok(stored) = serde_json::from_value::<StoredRoute>(value) else {
                continue;
            };
            let Some(route) = stored.into_route(resolve_agent) else {
                continue;
            };
            entries.push(route);
            if position <= stored_index {
                index = entries.len() - 1;
            }
        }
        if entries.is_empty() {
            Ok(None)
        } else {
            Ok(Some((entries, index)))
        }
    }

    pub(crate) fn write(&self, entries: &[Route], index: usize) -> io::Result<()> {
        let document = StoredDocument {
            version: DOCUMENT_VERSION,
            entries: entries
                .iter()
                .map(StoredRoute::from)
                .map(serde_json::to_value)
                .collect::<Result<_, _>>()
                .map_err(io::Error::other)?,
            index,
        };
        let bytes = serde_json::to_vec(&document).map_err(io::Error::other)?;
        atomic_write(&self.path, &bytes)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDocument {
    version: u32,
    entries: Vec<serde_json::Value>,
    index: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum StoredRoute {
    Home,
    Blueprint,
    Chats,
    HappyAgent {
        agent_namespace: String,
    },
    Group {
        agent_namespace: String,
        group_id: String,
    },
    Chat {
        agent_namespace: String,
        group_id: String,
        session_id: String,
    },
    File {
        agent_namespace: String,
        group_id: String,
        session_id: Option<String>,
        file_kind: String,
        path: String,
    },
    Create {
        agent_namespace: String,
    },
    Inbox {
        agent_namespace: String,
    },
    Social {
        agent_namespace: String,
    },
    Settings,
    SettingsSection {
        section: String,
    },
}

impl From<&Route> for StoredRoute {
    fn from(route: &Route) -> Self {
        match route {
            Route::Home => Self::Home,
            Route::Blueprint => Self::Blueprint,
            Route::Chats => Self::Chats,
            Route::HappyAgent { agent } => Self::HappyAgent {
                agent_namespace: agent.as_str().into(),
            },
            Route::Group { agent, group } => Self::Group {
                agent_namespace: agent.as_str().into(),
                group_id: group.as_str().into(),
            },
            Route::Chat {
                agent,
                group,
                session,
            } => Self::Chat {
                agent_namespace: agent.as_str().into(),
                group_id: group.as_str().into(),
                session_id: session.as_str().into(),
            },
            Route::File {
                agent,
                group,
                session,
                kind,
                path,
            } => Self::File {
                agent_namespace: agent.as_str().into(),
                group_id: group.as_str().into(),
                session_id: session.as_ref().map(|id| id.as_str().into()),
                file_kind: kind.as_str().into(),
                path: path.as_str().into(),
            },
            Route::Create { agent } => Self::Create {
                agent_namespace: agent.as_str().into(),
            },
            Route::Inbox { agent } => Self::Inbox {
                agent_namespace: agent.as_str().into(),
            },
            Route::Social { agent } => Self::Social {
                agent_namespace: agent.as_str().into(),
            },
            Route::Settings => Self::Settings,
            Route::SettingsSection { section } => Self::SettingsSection {
                section: section.as_str().into(),
            },
        }
    }
}

impl StoredRoute {
    fn into_route(self, resolve_agent: &impl Fn(&str) -> Option<AgentNamespace>) -> Option<Route> {
        let agent = |value: String| resolve_agent(&value);
        match self {
            Self::Home => Some(Route::Home),
            Self::Blueprint => Some(Route::Blueprint),
            Self::Chats => Some(Route::Chats),
            Self::HappyAgent { agent_namespace } => Some(Route::HappyAgent {
                agent: agent(agent_namespace)?,
            }),
            Self::Group {
                agent_namespace,
                group_id,
            } => Some(Route::Group {
                agent: agent(agent_namespace)?,
                group: GroupId::new(group_id).ok()?,
            }),
            Self::Chat {
                agent_namespace,
                group_id,
                session_id,
            } => Some(Route::Chat {
                agent: agent(agent_namespace)?,
                group: GroupId::new(group_id).ok()?,
                session: SessionId::new(session_id).ok()?,
            }),
            Self::File {
                agent_namespace,
                group_id,
                session_id,
                file_kind,
                path,
            } => Some(Route::File {
                agent: agent(agent_namespace)?,
                group: GroupId::new(group_id).ok()?,
                session: session_id.map(SessionId::new).transpose().ok()?,
                kind: FileKind::parse(&file_kind)?,
                path: FilePath::new(path).ok()?,
            }),
            Self::Create { agent_namespace } => Some(Route::Create {
                agent: agent(agent_namespace)?,
            }),
            Self::Inbox { agent_namespace } => Some(Route::Inbox {
                agent: agent(agent_namespace)?,
            }),
            Self::Social { agent_namespace } => Some(Route::Social {
                agent: agent(agent_namespace)?,
            }),
            Self::Settings => Some(Route::Settings),
            Self::SettingsSection { section } => Some(Route::SettingsSection {
                section: SettingsSection::parse(&section)?,
            }),
        }
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("history");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(".{stem}.{}.{}.tmp", std::process::id(), nonce));

    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
