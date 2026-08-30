//! Bounded owner-only Unix-socket transport for workspace files.

use async_channel::{Receiver, Sender, TrySendError};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use reqwest::{
    Method, Url,
    blocking::{Client, Response},
    header::{ACCEPT, AUTHORIZATION},
};
use serde::{Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Read,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use super::protocol::*;
use crate::connectivity::transport::ApiError;
use crate::connectivity::transport::{DaemonPaths, SecretToken, daemon_http_client};
use crate::connectivity::{TransportOptions, UserError, UserErrorKind};

const EVENT_CAPACITY: usize = 16;
// Commands + one executing request + queued result events never exceed the pending cap.
const COMMAND_CAPACITY: usize = MAX_PENDING_REQUESTS - EVENT_CAPACITY - 1;
const MAX_API_ERROR_BODY_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FileRequestId(pub u64);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileOperation {
    Search,
    Tree,
    Read,
    Write,
    Revision,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileEvent {
    SearchReady {
        request_id: FileRequestId,
        workspace_id: String,
        query: String,
        response: FileSearchResponse,
    },
    TreeReady {
        request_id: FileRequestId,
        workspace_id: String,
        query: FileTreeQuery,
        response: FileTreeResponse,
    },
    FileReady {
        request_id: FileRequestId,
        workspace_id: String,
        path: RelativeFilePath,
        bytes: Arc<[u8]>,
        hash: String,
    },
    FileWritten {
        request_id: FileRequestId,
        workspace_id: String,
        path: RelativeFilePath,
        revision: u64,
        text: Arc<str>,
        hash: String,
    },
    RevisionReady {
        request_id: FileRequestId,
        workspace_id: String,
        query: FileRevisionQuery,
        bytes: Arc<[u8]>,
    },
    Failed {
        request_id: FileRequestId,
        operation: FileOperation,
        workspace_id: String,
        path: Option<RelativeFilePath>,
        revision: Option<u64>,
        error: UserError,
    },
    Stopped,
}

enum FileCommand {
    Search {
        id: FileRequestId,
        workspace: String,
        query: FileSearchQuery,
    },
    Tree {
        id: FileRequestId,
        workspace: String,
        query: FileTreeQuery,
    },
    Read {
        id: FileRequestId,
        workspace: String,
        path: RelativeFilePath,
    },
    Write {
        id: FileRequestId,
        workspace: String,
        path: RelativeFilePath,
        text: Arc<str>,
        expected_hash: Option<Arc<str>>,
        revision: u64,
    },
    Revision {
        id: FileRequestId,
        workspace: String,
        query: FileRevisionQuery,
    },
}

pub struct FileTransport {
    commands: Sender<FileCommand>,
    events: Receiver<FileEvent>,
    next_id: AtomicU64,
}
impl FileTransport {
    pub fn receiver(&self) -> Receiver<FileEvent> {
        self.events.clone()
    }
    fn submit(
        &self,
        build: impl FnOnce(FileRequestId) -> FileCommand,
    ) -> Result<FileRequestId, UserError> {
        let id = FileRequestId(self.next_id.fetch_add(1, Ordering::Relaxed));
        self.commands
            .try_send(build(id))
            .map_err(|error| match error {
                TrySendError::Full(_) => safe_error(
                    UserErrorKind::Unavailable,
                    "Too many file requests are pending.",
                ),
                TrySendError::Closed(_) => safe_error(
                    UserErrorKind::Unavailable,
                    "The file service is unavailable.",
                ),
            })?;
        Ok(id)
    }
    pub fn search(
        &self,
        workspace: String,
        query: FileSearchQuery,
    ) -> Result<FileRequestId, UserError> {
        validate_workspace(&workspace)?;
        self.submit(|id| FileCommand::Search {
            id,
            workspace,
            query,
        })
    }
    pub fn tree(
        &self,
        workspace: String,
        query: FileTreeQuery,
    ) -> Result<FileRequestId, UserError> {
        validate_workspace(&workspace)?;
        self.submit(|id| FileCommand::Tree {
            id,
            workspace,
            query,
        })
    }
    pub fn read(
        &self,
        workspace: String,
        path: RelativeFilePath,
    ) -> Result<FileRequestId, UserError> {
        validate_workspace(&workspace)?;
        self.submit(|id| FileCommand::Read {
            id,
            workspace,
            path,
        })
    }
    pub fn write_text(
        &self,
        workspace: String,
        path: RelativeFilePath,
        text: Arc<str>,
        expected_hash: Option<Arc<str>>,
        revision: u64,
    ) -> Result<FileRequestId, UserError> {
        validate_workspace(&workspace)?;
        if text.len() > MAX_EDITOR_BYTES {
            return Err(safe_error(
                UserErrorKind::Protocol,
                "This text file exceeds the 4 MiB editor limit.",
            ));
        }
        if expected_hash.as_deref().is_some_and(|h| {
            h.len() != 64
                || !h
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        }) {
            return Err(safe_error(
                UserErrorKind::Protocol,
                "The file revision hash is invalid.",
            ));
        }
        self.submit(|id| FileCommand::Write {
            id,
            workspace,
            path,
            text,
            expected_hash,
            revision,
        })
    }
    pub fn revision(
        &self,
        workspace: String,
        query: FileRevisionQuery,
    ) -> Result<FileRequestId, UserError> {
        validate_workspace(&workspace)?;
        self.submit(|id| FileCommand::Revision {
            id,
            workspace,
            query,
        })
    }
}

pub fn start_file_transport(options: TransportOptions) -> FileTransport {
    let (command_tx, command_rx) = async_channel::bounded(COMMAND_CAPACITY);
    let (event_tx, event_rx) = async_channel::bounded(EVENT_CAPACITY);
    thread::Builder::new()
        .name("happy-agent-files".into())
        .spawn(move || worker(options, command_rx, event_tx))
        .expect("file transport worker should spawn");
    FileTransport {
        commands: command_tx,
        events: event_rx,
        next_id: AtomicU64::new(1),
    }
}

fn worker(options: TransportOptions, commands: Receiver<FileCommand>, events: Sender<FileEvent>) {
    let environment = if options.environment.is_empty() {
        std::env::vars().collect::<BTreeMap<_, _>>()
    } else {
        options.environment
    };
    while let Ok(command) = commands.recv_blocking() {
        let result = (|| {
            let paths = DaemonPaths::resolve(&environment, options.home_directory.as_deref())?;
            let token = SecretToken::read(&paths.token_path)?;
            let client = daemon_http_client(&paths.socket_path)?;
            execute(&client, &token, &command)
        })();
        let event = match result {
            Ok(value) => value,
            Err(error) => failure(&command, error),
        };
        if events.send_blocking(event).is_err() {
            return;
        }
    }
    let _ = events.send_blocking(FileEvent::Stopped);
}

fn execute(
    client: &Client,
    token: &SecretToken,
    command: &FileCommand,
) -> Result<FileEvent, UserError> {
    match command {
        FileCommand::Search {
            id,
            workspace,
            query,
        } => {
            let response: FileSearchResponse = request(
                client,
                token,
                Method::GET,
                workspace,
                "files",
                vec![
                    ("query", query.query.clone()),
                    (
                        "limit",
                        query.limit.map(|v| v.to_string()).unwrap_or_default(),
                    ),
                ],
                Option::<&()>::None,
            )?;
            validate_search(&response)?;
            Ok(FileEvent::SearchReady {
                request_id: *id,
                workspace_id: workspace.clone(),
                query: query.query.clone(),
                response,
            })
        }
        FileCommand::Tree {
            id,
            workspace,
            query,
        } => {
            let response: FileTreeResponse = request(
                client,
                token,
                Method::GET,
                workspace,
                "file-tree",
                vec![
                    ("path", query.path.as_str().to_owned()),
                    ("cursor", query.cursor.clone().unwrap_or_default()),
                    (
                        "limit",
                        query.limit.map(|v| v.to_string()).unwrap_or_default(),
                    ),
                ],
                Option::<&()>::None,
            )?;
            validate_tree(&response, &query.path)?;
            Ok(FileEvent::TreeReady {
                request_id: *id,
                workspace_id: workspace.clone(),
                query: query.clone(),
                response,
            })
        }
        FileCommand::Read {
            id,
            workspace,
            path,
        } => {
            let response: FileContentResponse = request(
                client,
                token,
                Method::GET,
                workspace,
                "file",
                vec![("path", path.as_str().to_owned())],
                Option::<&()>::None,
            )?;
            let bytes = decode(&response.content)?;
            verify_hash(&bytes, &response.hash)?;
            Ok(FileEvent::FileReady {
                request_id: *id,
                workspace_id: workspace.clone(),
                path: path.clone(),
                bytes: Arc::from(bytes),
                hash: response.hash,
            })
        }
        FileCommand::Write {
            id,
            workspace,
            path,
            text,
            expected_hash,
            revision,
        } => {
            let content = STANDARD.encode(text.as_bytes());
            let body = WriteFileRequest {
                path: path.as_str().to_owned(),
                content,
                expected_hash: expected_hash.as_deref().map(str::to_owned),
            };
            body.validate().map_err(input_error)?;
            let response: WriteFileResponse = request(
                client,
                token,
                Method::PUT,
                workspace,
                "file",
                Vec::new(),
                Some(&body),
            )?;
            verify_hash(text.as_bytes(), &response.hash)?;
            Ok(FileEvent::FileWritten {
                request_id: *id,
                workspace_id: workspace.clone(),
                path: path.clone(),
                revision: *revision,
                text: text.clone(),
                hash: response.hash,
            })
        }
        FileCommand::Revision {
            id,
            workspace,
            query,
        } => {
            let response: FileRevisionResponse = request(
                client,
                token,
                Method::GET,
                workspace,
                "file-revision",
                vec![
                    ("path", query.path.as_str().to_owned()),
                    ("revision", query.revision.clone()),
                ],
                Option::<&()>::None,
            )?;
            let bytes = decode(&response.content)?;
            Ok(FileEvent::RevisionReady {
                request_id: *id,
                workspace_id: workspace.clone(),
                query: query.clone(),
                bytes: Arc::from(bytes),
            })
        }
    }
}

fn failure(command: &FileCommand, error: UserError) -> FileEvent {
    let (id, op, workspace, path, revision) = match command {
        FileCommand::Search { id, workspace, .. } => {
            (*id, FileOperation::Search, workspace.clone(), None, None)
        }
        FileCommand::Tree { id, workspace, .. } => {
            (*id, FileOperation::Tree, workspace.clone(), None, None)
        }
        FileCommand::Read {
            id,
            workspace,
            path,
        } => (
            *id,
            FileOperation::Read,
            workspace.clone(),
            Some(path.clone()),
            None,
        ),
        FileCommand::Write {
            id,
            workspace,
            path,
            revision,
            ..
        } => (
            *id,
            FileOperation::Write,
            workspace.clone(),
            Some(path.clone()),
            Some(*revision),
        ),
        FileCommand::Revision {
            id,
            workspace,
            query,
        } => (
            *id,
            FileOperation::Revision,
            workspace.clone(),
            Some(query.path.clone()),
            None,
        ),
    };
    FileEvent::Failed {
        request_id: id,
        operation: op,
        workspace_id: workspace,
        path,
        revision,
        error,
    }
}

fn request<B: Serialize + ?Sized, T: DeserializeOwned>(
    client: &Client,
    token: &SecretToken,
    method: Method,
    workspace: &str,
    route: &str,
    query: Vec<(&str, String)>,
    body: Option<&B>,
) -> Result<T, UserError> {
    let mut url = Url::parse("http://happy-agent/").expect("fixed URL");
    {
        let mut parts = url.path_segments_mut().expect("path");
        parts.clear();
        parts.extend(["v0", "workspaces", workspace, route]);
    }
    {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in query {
            if !value.is_empty() {
                pairs.append_pair(key, &value);
            }
        }
    }
    let mut request = client
        .request(method, url)
        .timeout(Duration::from_secs(30))
        .header(ACCEPT, "application/json")
        .header(AUTHORIZATION, token.authorization());
    if let Some(body) = body {
        request = request.json(body)
    }
    let response = checked(
        request
            .send()
            .map_err(|_| safe_error(UserErrorKind::Unavailable, "Could not reach Happy Agent."))?,
        token,
    )?;
    let bytes = capped(response, MAX_FILE_JSON_BYTES)?;
    serde_json::from_slice(&bytes).map_err(|_| {
        safe_error(
            UserErrorKind::Protocol,
            "Happy Agent returned an invalid file response.",
        )
    })
}
fn checked(response: Response, token: &SecretToken) -> Result<Response, UserError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let mut body = capped(response, MAX_API_ERROR_BODY_BYTES)
        .ok()
        .and_then(|v| serde_json::from_slice::<serde_json::Value>(&v).ok());
    if let Some(v) = body.as_mut() {
        redact(v, token, 4096)
    }
    let code = body
        .as_ref()
        .and_then(|v| v.get("code"))
        .and_then(|v| v.as_str())
        .map(|v| bound(v, 256));
    let message = body
        .as_ref()
        .and_then(|v| v.get("error"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .map(|v| bound(&token.redact(v), MAX_ERROR_BYTES))
        .unwrap_or_else(|| format!("Happy Agent returned HTTP {status}."));
    Err(UserError {
        kind: UserErrorKind::Api,
        message: message.clone(),
        api: Some(ApiError {
            status,
            code,
            message,
            body,
        }),
    })
}
fn capped(mut response: Response, limit: u64) -> Result<Vec<u8>, UserError> {
    if response.content_length().is_some_and(|v| v > limit) {
        return Err(safe_error(
            UserErrorKind::Protocol,
            "Happy Agent returned a file response that is too large.",
        ));
    }
    let mut out = Vec::new();
    response
        .by_ref()
        .take(limit + 1)
        .read_to_end(&mut out)
        .map_err(|_| {
            safe_error(
                UserErrorKind::Unavailable,
                "Could not read the Happy Agent response.",
            )
        })?;
    if out.len() as u64 > limit {
        return Err(safe_error(
            UserErrorKind::Protocol,
            "Happy Agent returned a file response that is too large.",
        ));
    }
    Ok(out)
}
fn decode(value: &str) -> Result<Vec<u8>, UserError> {
    if value.len() > MAX_FILE_JSON_BYTES as usize {
        return Err(safe_error(
            UserErrorKind::Protocol,
            "Happy Agent returned file content that is too large.",
        ));
    }
    let bytes = STANDARD.decode(value).map_err(|_| {
        safe_error(
            UserErrorKind::Protocol,
            "Happy Agent returned invalid base64 file content.",
        )
    })?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(safe_error(
            UserErrorKind::Protocol,
            "Happy Agent returned a file that is too large.",
        ));
    }
    Ok(bytes)
}
fn verify_hash(bytes: &[u8], hash: &str) -> Result<(), UserError> {
    let actual = format!("{:x}", Sha256::digest(bytes));
    if hash.len() != 64 || hash != actual {
        return Err(safe_error(
            UserErrorKind::Protocol,
            "Happy Agent returned an invalid file hash.",
        ));
    }
    Ok(())
}
fn validate_search(response: &FileSearchResponse) -> Result<(), UserError> {
    if response.files.len() > MAX_SEARCH_RESULTS as usize {
        return Err(safe_error(
            UserErrorKind::Protocol,
            "Happy Agent returned too many search results.",
        ));
    }
    for file in &response.files {
        validate_relative_path(&file.path, false).map_err(input_error)?;
        if file.file_name.is_empty()
            || file.file_name.contains('/')
            || file.file_name.contains('\0')
        {
            return Err(safe_error(
                UserErrorKind::Protocol,
                "Happy Agent returned an invalid file name.",
            ));
        }
        if file.path.rsplit('/').next() != Some(file.file_name.as_str()) {
            return Err(safe_error(
                UserErrorKind::Protocol,
                "Happy Agent returned a mismatched file name.",
            ));
        }
    }
    Ok(())
}
fn validate_tree(
    response: &FileTreeResponse,
    directory: &RelativeDirectoryPath,
) -> Result<(), UserError> {
    if response.entries.len() > MAX_TREE_PAGE as usize {
        return Err(safe_error(
            UserErrorKind::Protocol,
            "Happy Agent returned too many directory entries.",
        ));
    }
    if let Some(cursor) = &response.next_cursor {
        if cursor.len() > MAX_CURSOR_BYTES {
            return Err(safe_error(
                UserErrorKind::Protocol,
                "Happy Agent returned an invalid directory cursor.",
            ));
        }
    }
    for entry in &response.entries {
        validate_relative_path(&entry.path, false).map_err(input_error)?;
        if entry.name.is_empty() || entry.name.contains('/') || entry.name.contains('\0') {
            return Err(safe_error(
                UserErrorKind::Protocol,
                "Happy Agent returned an invalid directory entry.",
            ));
        }
        let expected = if directory.as_str().is_empty() {
            entry.name.clone()
        } else {
            format!("{}/{}", directory.as_str(), entry.name)
        };
        if entry.path != expected {
            return Err(safe_error(
                UserErrorKind::Protocol,
                "Happy Agent returned a non-child directory entry.",
            ));
        }
    }
    Ok(())
}
fn validate_workspace(value: &str) -> Result<(), UserError> {
    if value.is_empty() || value.len() > MAX_REQUEST_ID_BYTES || value.contains('\0') {
        Err(safe_error(
            UserErrorKind::Protocol,
            "The workspace identifier is invalid.",
        ))
    } else {
        Ok(())
    }
}
fn input_error(_: FileInputError) -> UserError {
    safe_error(UserErrorKind::Protocol, "The file request is invalid.")
}
fn safe_error(kind: UserErrorKind, message: &str) -> UserError {
    UserError {
        kind,
        message: bound(message, MAX_ERROR_BYTES),
        api: None,
    }
}
fn bound(value: &str, max: usize) -> String {
    if value.len() <= max {
        return value.to_owned();
    }
    let mut end = max;
    while !value.is_char_boundary(end) {
        end -= 1
    }
    value[..end].to_owned()
}
fn redact(value: &mut serde_json::Value, token: &SecretToken, mut nodes: usize) {
    fn walk(value: &mut serde_json::Value, token: &SecretToken, nodes: &mut usize) {
        if *nodes == 0 {
            *value = serde_json::Value::String("[omitted]".into());
            return;
        }
        *nodes -= 1;
        match value {
            serde_json::Value::String(v) => *v = bound(&token.redact(v), MAX_ERROR_BYTES),
            serde_json::Value::Array(v) => {
                let mut clean = Vec::new();
                for mut item in std::mem::take(v) {
                    if *nodes == 0 {
                        clean.push(serde_json::Value::String("[omitted]".into()));
                        break;
                    }
                    walk(&mut item, token, nodes);
                    clean.push(item);
                }
                *v = clean;
            }
            serde_json::Value::Object(v) => {
                let mut clean = serde_json::Map::new();
                for (key, mut item) in std::mem::take(v) {
                    if *nodes == 0 {
                        clean.insert(
                            "[omitted]".into(),
                            serde_json::Value::String("[omitted]".into()),
                        );
                        break;
                    }
                    walk(&mut item, token, nodes);
                    clean.insert(bound(&token.redact(&key), MAX_ERROR_BYTES), item);
                }
                *v = clean;
            }
            _ => {}
        }
    }
    walk(value, token, &mut nodes)
}
