use std::{fmt, sync::Arc};

use crate::connectivity::AgentNamespace;

macro_rules! opaque_text {
    ($name:ident, $label:literal) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(Arc<str>);

        impl $name {
            pub fn new(value: impl Into<Arc<str>>) -> Result<Self, RouteParseError> {
                let value = value.into();
                if value.is_empty() {
                    return Err(RouteParseError::EmptyValue($label));
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }
    };
}

opaque_text!(GroupId, "group id");
opaque_text!(SessionId, "session id");

/// A daemon workspace-relative POSIX file path.
///
/// The daemon is the final authority, but rejecting traversal and platform
/// separators at route construction keeps unsafe values out of retained UI
/// identity and persistence.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FilePath(Arc<str>);
impl FilePath {
    pub fn new(value: impl Into<Arc<str>>) -> Result<Self, RouteParseError> {
        let value = value.into();
        let bytes = value.as_bytes();
        if bytes.is_empty()
            || bytes.len() > 16_384
            || bytes[0] == b'/'
            || bytes.contains(&b'\\')
            || bytes.contains(&0)
            || value
                .split('/')
                .any(|component| component.is_empty() || component == "." || component == "..")
        {
            return Err(RouteParseError::InvalidPath);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl fmt::Display for FilePath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FileKind {
    File,
    Diff,
    Media,
    Document,
}

impl FileKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Diff => "diff",
            Self::Media => "media",
            Self::Document => "document",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "file" => Some(Self::File),
            "diff" => Some(Self::Diff),
            "media" => Some(Self::Media),
            "document" => Some(Self::Document),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SettingsSection {
    General,
    Account,
    Instructions,
    Secrets,
    Providers,
    Usage,
    MobileAccess,
    Debug,
}

impl SettingsSection {
    pub const ALL: [Self; 8] = [
        Self::General,
        Self::Account,
        Self::Instructions,
        Self::Secrets,
        Self::Providers,
        Self::Usage,
        Self::MobileAccess,
        Self::Debug,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::Account => "account",
            Self::Instructions => "instructions",
            Self::Secrets => "secrets",
            Self::Providers => "providers",
            Self::Usage => "usage",
            Self::MobileAccess => "mobile-access",
            Self::Debug => "debug",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|section| section.as_str() == value)
    }
}

/// Every destination the native window can address.
///
/// Machine identity is always the stable [`AgentNamespace`] owned by the
/// connectivity layer. Project/worktree and session identities remain separate
/// opaque types, so identities from different protocol domains cannot mix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    Home,
    Blueprint,
    Chats,
    HappyAgent {
        agent: AgentNamespace,
    },
    Group {
        agent: AgentNamespace,
        group: GroupId,
    },
    Chat {
        agent: AgentNamespace,
        group: GroupId,
        session: SessionId,
    },
    File {
        agent: AgentNamespace,
        group: GroupId,
        session: Option<SessionId>,
        kind: FileKind,
        path: FilePath,
    },
    Create {
        agent: AgentNamespace,
    },
    Inbox {
        agent: AgentNamespace,
    },
    Social {
        agent: AgentNamespace,
    },
    Settings,
    SettingsSection {
        section: SettingsSection,
    },
}

impl Route {
    pub fn path(&self) -> String {
        match self {
            Self::Home => "/".into(),
            Self::Blueprint => "/blueprint".into(),
            Self::Chats => "/chats".into(),
            Self::HappyAgent { agent } => format!("/chats/{}", encode(agent.as_str())),
            Self::Group { agent, group } => {
                format!(
                    "/chats/{}/{}",
                    encode(agent.as_str()),
                    encode(group.as_str())
                )
            }
            Self::Chat {
                agent,
                group,
                session,
            } => format!(
                "/chats/{}/{}/{}",
                encode(agent.as_str()),
                encode(group.as_str()),
                encode(session.as_str())
            ),
            Self::File {
                agent,
                group,
                session,
                kind,
                path,
            } => {
                let parent = session
                    .as_ref()
                    .map(|session| format!("/{}", encode(session.as_str())))
                    .unwrap_or_default();
                format!(
                    "/chats/{}/{}{}/file/{}/{}",
                    encode(agent.as_str()),
                    encode(group.as_str()),
                    parent,
                    kind.as_str(),
                    encode(path.as_str())
                )
            }
            Self::Create { agent } => format!("/create/{}", encode(agent.as_str())),
            Self::Inbox { agent } => format!("/inbox/{}", encode(agent.as_str())),
            Self::Social { agent } => format!("/social/{}", encode(agent.as_str())),
            Self::Settings => "/settings".into(),
            Self::SettingsSection { section } => format!("/settings/{}", section.as_str()),
        }
    }

    /// Parses an exact native route. The resolver is the only way text becomes
    /// a machine identity; navigation never invents an `AgentNamespace`.
    pub fn parse_with(
        path: &str,
        resolve_agent: impl Fn(&str) -> Option<AgentNamespace>,
    ) -> Result<Self, RouteParseError> {
        let path = path.split(['?', '#']).next().unwrap_or(path);
        if path == "/" {
            return Ok(Self::Home);
        }
        if !path.starts_with('/') || path.ends_with('/') {
            return Err(RouteParseError::InvalidPath);
        }
        let raw: Vec<_> = path[1..].split('/').collect();
        if raw.iter().any(|part| part.is_empty()) {
            return Err(RouteParseError::InvalidPath);
        }
        let parts: Vec<String> = raw.into_iter().map(decode).collect::<Result<_, _>>()?;
        let agent = |value: &str| {
            resolve_agent(value).ok_or_else(|| RouteParseError::UnknownAgent(value.into()))
        };
        match parts.as_slice() {
            [head] if head == "blueprint" => Ok(Self::Blueprint),
            [head] if head == "chats" => Ok(Self::Chats),
            [head, id] if head == "chats" => Ok(Self::HappyAgent { agent: agent(id)? }),
            [head, id, group] if head == "chats" => Ok(Self::Group {
                agent: agent(id)?,
                group: GroupId::new(group.as_str())?,
            }),
            [head, id, group, session] if head == "chats" => Ok(Self::Chat {
                agent: agent(id)?,
                group: GroupId::new(group.as_str())?,
                session: SessionId::new(session.as_str())?,
            }),
            [head, id, group, file, kind, path] if head == "chats" && file == "file" => {
                Ok(Self::File {
                    agent: agent(id)?,
                    group: GroupId::new(group.as_str())?,
                    session: None,
                    kind: FileKind::parse(kind)
                        .ok_or_else(|| RouteParseError::UnknownFileKind(kind.clone()))?,
                    path: FilePath::new(path.as_str())?,
                })
            }
            [head, id, group, session, file, kind, path] if head == "chats" && file == "file" => {
                Ok(Self::File {
                    agent: agent(id)?,
                    group: GroupId::new(group.as_str())?,
                    session: Some(SessionId::new(session.as_str())?),
                    kind: FileKind::parse(kind)
                        .ok_or_else(|| RouteParseError::UnknownFileKind(kind.clone()))?,
                    path: FilePath::new(path.as_str())?,
                })
            }
            [head, id] if head == "create" => Ok(Self::Create { agent: agent(id)? }),
            [head, id] if head == "inbox" => Ok(Self::Inbox { agent: agent(id)? }),
            [head, id] if head == "social" => Ok(Self::Social { agent: agent(id)? }),
            [head] if head == "settings" => Ok(Self::Settings),
            [head, section] if head == "settings" => Ok(Self::SettingsSection {
                section: SettingsSection::parse(section)
                    .ok_or_else(|| RouteParseError::UnknownSettingsSection(section.clone()))?,
            }),
            _ => Err(RouteParseError::UnknownRoute),
        }
    }

    /// File presentation and backing chat are mutable views of one file tab.
    pub fn same_destination(&self, other: &Self) -> bool {
        match (self, other) {
            (
                Self::File {
                    agent: left_agent,
                    group: left_group,
                    path: left_path,
                    ..
                },
                Self::File {
                    agent: right_agent,
                    group: right_group,
                    path: right_path,
                    ..
                },
            ) => left_agent == right_agent && left_group == right_group && left_path == right_path,
            _ => self == other,
        }
    }

    pub fn is_in_group(&self, agent: &AgentNamespace, group: &GroupId) -> bool {
        match self {
            Self::Group {
                agent: own_agent,
                group: own_group,
            }
            | Self::Chat {
                agent: own_agent,
                group: own_group,
                ..
            }
            | Self::File {
                agent: own_agent,
                group: own_group,
                ..
            } => own_agent == agent && own_group == group,
            _ => false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RouteParseError {
    InvalidPath,
    InvalidPercentEncoding,
    InvalidUtf8,
    EmptyValue(&'static str),
    UnknownAgent(String),
    UnknownFileKind(String),
    UnknownSettingsSection(String),
    UnknownRoute,
}

fn is_unescaped(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
        )
}

fn encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if is_unescaped(byte) {
            encoded.push(char::from(byte));
        } else {
            use fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn decode(value: &str) -> Result<String, RouteParseError> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'%' => {
                if at + 2 >= bytes.len() {
                    return Err(RouteParseError::InvalidPercentEncoding);
                }
                let high = hex(bytes[at + 1]).ok_or(RouteParseError::InvalidPercentEncoding)?;
                let low = hex(bytes[at + 2]).ok_or(RouteParseError::InvalidPercentEncoding)?;
                decoded.push((high << 4) | low);
                at += 3;
            }
            byte if is_unescaped(byte) => {
                decoded.push(byte);
                at += 1;
            }
            _ => return Err(RouteParseError::InvalidPercentEncoding),
        }
    }
    String::from_utf8(decoded).map_err(|_| RouteParseError::InvalidUtf8)
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
