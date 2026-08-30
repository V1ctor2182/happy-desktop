//! Authenticated protocol-v23 terminal REST and WebSocket transport over the daemon Unix socket.

use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use reqwest::{
    Method, StatusCode,
    blocking::Client,
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
};
use serde::{Serialize, de::DeserializeOwned};
use std::{collections::BTreeMap, io::Read, os::unix::net::UnixStream, time::Duration};
use tungstenite::{
    WebSocket,
    client::{IntoClientRequest, client_with_config},
    protocol::{Message, WebSocketConfig},
};

use super::protocol::{
    MAX_ENVELOPE_BYTES, MAX_SAFE_INTEGER, OpenTerminalRequest, ResizeTerminalRequest,
    TerminalColorScheme, TerminalListResponse, TerminalRecord, TerminalResponse,
    validate_terminal_record,
};
use crate::connectivity::transport::{DaemonPaths, SecretToken, daemon_http_client};
use crate::connectivity::{TransportOptions, UserError, UserErrorKind};

const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;
const MAX_ID_BYTES: usize = 256;

#[derive(Clone, Debug, Default)]
pub struct OpenTerminal {
    pub shell: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub max_scrollback: Option<usize>,
    pub color_scheme: Option<TerminalColorScheme>,
    pub mutation_id: Option<String>,
}

pub struct TerminalTransport {
    client: Client,
    paths: DaemonPaths,
    token: SecretToken,
}
impl TerminalTransport {
    pub fn connect(options: TransportOptions) -> Result<Self, UserError> {
        let environment = if options.environment.is_empty() {
            std::env::vars().collect::<BTreeMap<_, _>>()
        } else {
            options.environment
        };
        let paths = DaemonPaths::resolve(&environment, options.home_directory.as_deref())?;
        let token = SecretToken::read(&paths.token_path)?;
        let client = daemon_http_client(&paths.socket_path)?;
        Ok(Self {
            client,
            paths,
            token,
        })
    }
    pub fn list(&self, workspace: &str) -> Result<Vec<TerminalRecord>, UserError> {
        validate_id(workspace)?;
        let terminals = self
            .request::<(), TerminalListResponse>(Method::GET, &collection(workspace), None)?
            .terminals;
        for terminal in &terminals {
            validate_record(terminal)?;
            if terminal.workspace_id != workspace {
                return Err(protocol(
                    "Happy Agent returned a terminal for the wrong workspace.",
                ));
            }
        }
        Ok(terminals)
    }
    /// Reads the collection and returns only the record whose daemon identity
    /// exactly matches `terminal`. No local derivation or fallback identity is used.
    pub fn existing(&self, workspace: &str, terminal: &str) -> Result<TerminalRecord, UserError> {
        validate_id(workspace)?;
        validate_id(terminal)?;
        let terminals = self.list(workspace)?;
        let Some(record) = terminals.into_iter().find(|record| record.id == terminal) else {
            return Err(UserError {
                kind: UserErrorKind::Api,
                message: "The terminal does not exist in this workspace.".into(),
                api: None,
            });
        };
        if record.workspace_id != workspace {
            return Err(protocol(
                "Happy Agent returned a terminal for the wrong workspace.",
            ));
        }
        Ok(record)
    }
    pub fn create(&self, workspace: &str, open: OpenTerminal) -> Result<TerminalRecord, UserError> {
        validate_id(workspace)?;
        dimensions_optional(open.cols, open.rows)?;
        if open.max_scrollback.is_some_and(|value| {
            u64::try_from(value).map_or(true, |value| value > MAX_SAFE_INTEGER)
        }) {
            return Err(protocol("The terminal scrollback limit is invalid."));
        }
        let request = OpenTerminalRequest {
            shell: open.shell,
            command: open.command,
            cwd: open.cwd,
            cols: open.cols,
            rows: open.rows,
            max_scrollback: open.max_scrollback,
            color_scheme: open.color_scheme,
            mutation_id: open.mutation_id,
        };
        let terminal = self
            .request::<OpenTerminalRequest, TerminalResponse>(
                Method::POST,
                &collection(workspace),
                Some(&request),
            )?
            .terminal;
        validate_record(&terminal)?;
        if terminal.workspace_id != workspace {
            return Err(protocol(
                "Happy Agent returned a terminal for the wrong workspace.",
            ));
        }
        Ok(terminal)
    }
    pub fn resize(
        &self,
        workspace: &str,
        terminal: &str,
        cols: u16,
        rows: u16,
        mutation_id: Option<String>,
    ) -> Result<TerminalRecord, UserError> {
        validate_id(workspace)?;
        validate_id(terminal)?;
        dimensions(cols, rows)?;
        let body = ResizeTerminalRequest {
            cols,
            rows,
            mutation_id,
        };
        let record = self
            .request::<ResizeTerminalRequest, TerminalResponse>(
                Method::PATCH,
                &member(workspace, terminal),
                Some(&body),
            )?
            .terminal;
        validate_expected_record(&record, workspace, terminal)?;
        Ok(record)
    }
    pub fn stop(&self, workspace: &str, terminal: &str) -> Result<TerminalRecord, UserError> {
        validate_id(workspace)?;
        validate_id(terminal)?;
        let record = self
            .request::<(), TerminalResponse>(Method::DELETE, &member(workspace, terminal), None)?
            .terminal;
        validate_expected_record(&record, workspace, terminal)?;
        Ok(record)
    }
    pub fn attach(&self, workspace: &str, terminal: &str) -> Result<TerminalSocket, UserError> {
        validate_id(workspace)?;
        validate_id(terminal)?;
        let stream = UnixStream::connect(&self.paths.socket_path)
            .map_err(|_| unavailable("The terminal connection is unavailable."))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(|_| unavailable("The terminal connection could not be configured."))?;
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(|_| unavailable("The terminal connection could not be configured."))?;
        let uri = format!("ws://happy-agent{}/attach", member(workspace, terminal));
        let mut request = uri
            .into_client_request()
            .map_err(|_| protocol("The terminal attachment request is invalid."))?;
        request.headers_mut().insert(
            AUTHORIZATION.as_str(),
            self.token
                .authorization()
                .parse()
                .map_err(|_| protocol("The terminal authorization is invalid."))?,
        );
        // One WebSocket message carries at most one complete 32 MiB protocol
        // envelope. The protocol decoder separately bounds inflated payloads and batches.
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_ENVELOPE_BYTES))
            .max_frame_size(Some(MAX_ENVELOPE_BYTES));
        let (mut socket, _) = client_with_config(request, stream, Some(config))
            .map_err(|_| unavailable("The terminal attachment was refused."))?;
        socket
            .get_mut()
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|_| unavailable("The terminal connection could not be configured."))?;
        Ok(TerminalSocket { socket })
    }
    fn request<B: Serialize, R: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<R, UserError> {
        let operation = TerminalOperation::from_method(&method);
        let mut req = self
            .client
            .request(method, format!("http://happy-agent{path}"))
            .header(ACCEPT, "application/json")
            .header(AUTHORIZATION, self.token.authorization());
        if let Some(body) = body {
            req = req.header(CONTENT_TYPE, "application/json").json(body)
        }
        let response = req
            .send()
            .map_err(|_| unavailable("Happy Agent is unavailable."))?;
        let status = response.status();
        let mut bytes = Vec::new();
        response
            .take(MAX_RESPONSE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| unavailable("Happy Agent returned an unreadable response."))?;
        if bytes.len() as u64 > MAX_RESPONSE_BYTES {
            return Err(protocol(
                "Happy Agent returned an oversized terminal response.",
            ));
        }
        if !status.is_success() {
            return Err(UserError {
                kind: UserErrorKind::Api,
                message: terminal_request_error(operation, status).into(),
                api: None,
            });
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| protocol("Happy Agent returned an invalid terminal response."))
    }
}

pub struct TerminalSocket {
    socket: WebSocket<UnixStream>,
}
impl TerminalSocket {
    pub fn send(&mut self, data: Vec<u8>) -> Result<(), UserError> {
        self.socket
            .send(Message::Binary(data.into()))
            .map_err(|_| unavailable("The terminal connection was lost."))
    }
    /// `Ok(None)` is a bounded read timeout, not a disconnect.
    pub fn receive(&mut self) -> Result<Option<Vec<u8>>, UserError> {
        match self.socket.read() {
            Ok(Message::Binary(v)) => Ok(Some(v.to_vec())),
            Ok(Message::Ping(v)) => {
                self.socket
                    .send(Message::Pong(v))
                    .map_err(|_| unavailable("The terminal connection was lost."))?;
                Ok(None)
            }
            Ok(Message::Close(_)) => Err(unavailable("The terminal connection closed.")),
            Ok(_) => Err(protocol("The terminal connection sent a non-binary frame.")),
            Err(tungstenite::Error::Io(e))
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                Ok(None)
            }
            Err(_) => Err(unavailable("The terminal connection was lost.")),
        }
    }
    pub fn close(mut self) {
        let _ = self.socket.close(None);
    }
}
fn collection(w: &str) -> String {
    format!("/v0/workspaces/{}/terminals", encode(w))
}
fn member(w: &str, t: &str) -> String {
    format!("{}/{}", collection(w), encode(t))
}
fn encode(v: &str) -> String {
    utf8_percent_encode(v, NON_ALPHANUMERIC).to_string()
}
fn validate_id(v: &str) -> Result<(), UserError> {
    if v.is_empty() || v.len() > MAX_ID_BYTES || v.contains(['\0', '/']) {
        Err(protocol("The terminal identity is invalid."))
    } else {
        Ok(())
    }
}
fn dimensions(c: u16, r: u16) -> Result<(), UserError> {
    if c == 0 || c > 1000 || r == 0 || r > 1000 {
        Err(protocol("The terminal dimensions are invalid."))
    } else {
        Ok(())
    }
}
fn dimensions_optional(c: Option<u16>, r: Option<u16>) -> Result<(), UserError> {
    if c.is_some_and(|v| v == 0 || v > 1000) || r.is_some_and(|v| v == 0 || v > 1000) {
        Err(protocol("The terminal dimensions are invalid."))
    } else {
        Ok(())
    }
}
fn validate_record(record: &TerminalRecord) -> Result<(), UserError> {
    validate_terminal_record(record)
        .map_err(|_| protocol("Happy Agent returned an invalid terminal record."))
}
fn validate_expected_record(
    record: &TerminalRecord,
    workspace: &str,
    terminal: &str,
) -> Result<(), UserError> {
    validate_record(record)?;
    if record.workspace_id != workspace || record.id != terminal {
        return Err(protocol("Happy Agent returned the wrong terminal record."));
    }
    Ok(())
}
fn unavailable(message: &str) -> UserError {
    UserError {
        kind: UserErrorKind::Unavailable,
        message: message.into(),
        api: None,
    }
}
fn protocol(message: &str) -> UserError {
    UserError {
        kind: UserErrorKind::Protocol,
        message: message.into(),
        api: None,
    }
}
#[derive(Clone, Copy)]
enum TerminalOperation {
    List,
    Create,
    Resize,
    Stop,
}
impl TerminalOperation {
    fn from_method(method: &Method) -> Self {
        if *method == Method::GET {
            Self::List
        } else if *method == Method::POST {
            Self::Create
        } else if *method == Method::PATCH {
            Self::Resize
        } else if *method == Method::DELETE {
            Self::Stop
        } else {
            unreachable!("unsupported terminal REST method")
        }
    }
}
fn terminal_request_error(operation: TerminalOperation, status: StatusCode) -> &'static str {
    enum Failure {
        Rejected,
        Unauthorized,
        Missing,
        Conflict,
        Busy,
        Server,
        Other,
    }
    let failure = if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        Failure::Unauthorized
    } else if status == StatusCode::NOT_FOUND {
        Failure::Missing
    } else if status == StatusCode::CONFLICT {
        Failure::Conflict
    } else if status == StatusCode::TOO_MANY_REQUESTS {
        Failure::Busy
    } else if status.is_client_error() {
        Failure::Rejected
    } else if status.is_server_error() {
        Failure::Server
    } else {
        Failure::Other
    };
    match (operation, failure) {
        (TerminalOperation::List, Failure::Rejected) => {
            "Happy Agent rejected the request to list terminals."
        }
        (TerminalOperation::Create, Failure::Rejected) => {
            "Happy Agent rejected the request to create the terminal."
        }
        (TerminalOperation::Resize, Failure::Rejected) => {
            "Happy Agent rejected the request to resize the terminal."
        }
        (TerminalOperation::Stop, Failure::Rejected) => {
            "Happy Agent rejected the request to stop the terminal."
        }
        (TerminalOperation::List, Failure::Unauthorized) => {
            "Happy Agent did not authorize listing terminals."
        }
        (TerminalOperation::Create, Failure::Unauthorized) => {
            "Happy Agent did not authorize creating the terminal."
        }
        (TerminalOperation::Resize, Failure::Unauthorized) => {
            "Happy Agent did not authorize resizing the terminal."
        }
        (TerminalOperation::Stop, Failure::Unauthorized) => {
            "Happy Agent did not authorize stopping the terminal."
        }
        (TerminalOperation::List, Failure::Missing) => {
            "Happy Agent could not find the terminal collection."
        }
        (TerminalOperation::Create, Failure::Missing) => {
            "Happy Agent could not find the terminal collection."
        }
        (TerminalOperation::Resize, Failure::Missing) => {
            "Happy Agent could not find the terminal to resize."
        }
        (TerminalOperation::Stop, Failure::Missing) => {
            "Happy Agent could not find the terminal to stop."
        }
        (TerminalOperation::List, Failure::Conflict) => {
            "The request to list terminals conflicts with the current state."
        }
        (TerminalOperation::Create, Failure::Conflict) => {
            "The request to create the terminal conflicts with the current state."
        }
        (TerminalOperation::Resize, Failure::Conflict) => {
            "The request to resize the terminal conflicts with the current state."
        }
        (TerminalOperation::Stop, Failure::Conflict) => {
            "The request to stop the terminal conflicts with the current state."
        }
        (TerminalOperation::List, Failure::Busy) => {
            "Happy Agent is busy. Try listing terminals again."
        }
        (TerminalOperation::Create, Failure::Busy) => {
            "Happy Agent is busy. Try creating the terminal again."
        }
        (TerminalOperation::Resize, Failure::Busy) => {
            "Happy Agent is busy. Try resizing the terminal again."
        }
        (TerminalOperation::Stop, Failure::Busy) => {
            "Happy Agent is busy. Try stopping the terminal again."
        }
        (TerminalOperation::List, Failure::Server) => {
            "Happy Agent could not complete the request to list terminals."
        }
        (TerminalOperation::Create, Failure::Server) => {
            "Happy Agent could not complete the request to create the terminal."
        }
        (TerminalOperation::Resize, Failure::Server) => {
            "Happy Agent could not complete the request to resize the terminal."
        }
        (TerminalOperation::Stop, Failure::Server) => {
            "Happy Agent could not complete the request to stop the terminal."
        }
        (TerminalOperation::List, Failure::Other) => "The request to list terminals failed.",
        (TerminalOperation::Create, Failure::Other) => "The request to create the terminal failed.",
        (TerminalOperation::Resize, Failure::Other) => "The request to resize the terminal failed.",
        (TerminalOperation::Stop, Failure::Other) => "The request to stop the terminal failed.",
    }
}
