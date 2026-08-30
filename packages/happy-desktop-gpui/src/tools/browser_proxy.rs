//! Fail-closed, authenticated loopback HTTP CONNECT bridge for native WebKit.
//!
//! The bridge never resolves or dials an Internet host. Every accepted target is carried through
//! the authenticated protocol-v23 Happy Agent workspace proxy on its Unix-domain socket.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{self, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    os::unix::net::UnixStream,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

use crate::connectivity::{
    TransportOptions,
    transport::{DaemonPaths, SecretToken},
};

const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_AUTHORIZATION_BYTES: usize = 512;
const MAX_TARGET_BYTES: usize = 1024;
const MAX_CONNECTIONS: usize = 64;
const IO_TIMEOUT: Duration = Duration::from_secs(15);

/// A loopback proxy capability. Its credentials stay private to the native WebKit bridge.
pub struct BrowserProxy {
    port: u16,
    username: Secret,
    password: Secret,
    shared: Arc<Shared>,
    accept_thread: Option<thread::JoinHandle<()>>,
    join_on_drop: bool,
}

struct Shared {
    stopping: AtomicBool,
    connections: AtomicUsize,
    next_connection: AtomicU64,
    clients: Mutex<BTreeMap<u64, TcpStream>>,
    daemons: Mutex<BTreeMap<u64, UnixStream>>,
    workers: Mutex<Vec<thread::JoinHandle<()>>>,
    socket_path: PathBuf,
    daemon_authorization: Secret,
    proxy_authorization: Secret,
    workspace_path: String,
}

struct ConnectionGuard {
    id: u64,
    shared: Arc<Shared>,
}

#[derive(Default)]
struct Secret(Vec<u8>);

impl Secret {
    fn from_bytes(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }
    fn as_bytes(&self) -> &[u8] {
        &self.0
    }
    fn as_str(&self) -> &str {
        // Credentials and authorization headers are constructed from ASCII only.
        unsafe { std::str::from_utf8_unchecked(&self.0) }
    }
}
impl Drop for Secret {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

impl BrowserProxy {
    /// Binds an ephemeral IPv4-loopback port and starts the bounded CONNECT bridge.
    pub fn start(workspace_id: &str, options: TransportOptions) -> io::Result<Self> {
        validate_workspace_id(workspace_id)?;
        let environment = if options.environment.is_empty() {
            std::env::vars().collect::<BTreeMap<_, _>>()
        } else {
            options.environment
        };
        let paths = DaemonPaths::resolve(&environment, options.home_directory.as_deref())
            .map_err(|_| io::Error::new(io::ErrorKind::NotFound, "Happy Agent is unavailable."))?;
        let token = SecretToken::read(&paths.token_path).map_err(|_| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Happy Agent authentication is unavailable.",
            )
        })?;

        let username = random_credential(24)?;
        let password = random_credential(32)?;
        let mut joined = format!("{}:{}", username.as_str(), password.as_str());
        let mut encoded = STANDARD.encode(joined.as_bytes());
        // Zero every temporary that held credentials, not only the retained capability fields.
        unsafe { joined.as_bytes_mut() }.fill(0);
        let mut proxy_authorization_bytes = Vec::with_capacity(6 + encoded.len());
        proxy_authorization_bytes.extend_from_slice(b"Basic ");
        proxy_authorization_bytes.extend_from_slice(encoded.as_bytes());
        unsafe { encoded.as_bytes_mut() }.fill(0);
        let proxy_authorization = Secret::from_bytes(proxy_authorization_bytes);
        let daemon_authorization = Secret::from_bytes(token.authorization().into_bytes());
        drop(token);

        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let shared = Arc::new(Shared {
            stopping: AtomicBool::new(false),
            connections: AtomicUsize::new(0),
            next_connection: AtomicU64::new(1),
            clients: Mutex::new(BTreeMap::new()),
            daemons: Mutex::new(BTreeMap::new()),
            workers: Mutex::new(Vec::new()),
            socket_path: paths.socket_path,
            daemon_authorization,
            proxy_authorization,
            workspace_path: format!(
                "/v0/workspaces/{}/proxy",
                utf8_percent_encode(workspace_id, NON_ALPHANUMERIC)
            ),
        });
        let accept_shared = Arc::clone(&shared);
        let accept_thread = thread::Builder::new()
            .name("happy-browser-proxy".into())
            .spawn(move || accept_loop(listener, accept_shared))?;
        Ok(Self {
            port,
            username,
            password,
            shared,
            accept_thread: Some(accept_thread),
            join_on_drop: true,
        })
    }

    pub(crate) fn port(&self) -> u16 {
        self.port
    }
    pub(crate) fn username(&self) -> &str {
        self.username.as_str()
    }
    pub(crate) fn password(&self) -> &str {
        self.password.as_str()
    }

    /// Revokes an unused prepared capability immediately without joining proxy threads on the
    /// caller. Used only when a background reconnect result is stale or cannot be applied.
    pub(crate) fn retire(mut self) {
        self.revoke();
        // Dropping JoinHandle detaches rather than joins. Every admission path observes
        // `stopping`, and tracked sockets were shut down above, so no usable capability survives.
        self.join_on_drop = false;
    }

    fn revoke(&self) {
        self.shared.stopping.store(true, Ordering::Release);
        if let Ok(clients) = self.shared.clients.lock() {
            for client in clients.values() {
                let _ = client.shutdown(Shutdown::Both);
            }
        }
        if let Ok(daemons) = self.shared.daemons.lock() {
            for daemon in daemons.values() {
                let _ = daemon.shutdown(Shutdown::Both);
            }
        }
        // Wake the blocking loop. It checks `stopping` before admitting the socket.
        let _ = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, self.port));
    }
}

impl Drop for BrowserProxy {
    fn drop(&mut self) {
        self.revoke();
        if !self.join_on_drop {
            return;
        }
        // Joining makes listener revocation complete before a synchronous offline transition
        // returns. `retire` disables joins only for never-applied background results.
        if let Some(thread) = self.accept_thread.take() {
            let _ = thread.join();
        }
        if let Ok(mut workers) = self.shared.workers.lock() {
            for worker in workers.drain(..) {
                let _ = worker.join();
            }
        }
    }
}

fn accept_loop(listener: TcpListener, shared: Arc<Shared>) {
    for accepted in listener.incoming() {
        let Ok(stream) = accepted else {
            if shared.stopping.load(Ordering::Acquire) {
                break;
            }
            continue;
        };
        if shared.stopping.load(Ordering::Acquire) {
            break;
        }
        reap_workers(&shared);
        if !stream
            .peer_addr()
            .is_ok_and(|address| address.ip().is_loopback())
        {
            continue;
        }
        if shared.connections.fetch_add(1, Ordering::AcqRel) >= MAX_CONNECTIONS {
            shared.connections.fetch_sub(1, Ordering::AcqRel);
            reject(stream, 503, "Service Unavailable");
            continue;
        }
        let id = shared.next_connection.fetch_add(1, Ordering::Relaxed);
        let Ok(tracked) = stream.try_clone() else {
            shared.connections.fetch_sub(1, Ordering::AcqRel);
            continue;
        };
        let admitted = if let Ok(mut clients) = shared.clients.lock() {
            if shared.stopping.load(Ordering::Acquire) {
                false
            } else {
                clients.insert(id, tracked);
                true
            }
        } else {
            false
        };
        if !admitted {
            shared.connections.fetch_sub(1, Ordering::AcqRel);
            let _ = stream.shutdown(Shutdown::Both);
            continue;
        }
        let connection_shared = Arc::clone(&shared);
        match thread::Builder::new()
            .name("happy-browser-tunnel".into())
            .spawn(move || {
                let _guard = ConnectionGuard {
                    id,
                    shared: Arc::clone(&connection_shared),
                };
                let _ = serve(stream, &connection_shared, id);
            }) {
            Ok(worker) => {
                if let Ok(mut workers) = shared.workers.lock() {
                    workers.push(worker);
                } else {
                    // A poisoned registry is fail-closed. The worker still sees `stopping` once
                    // BrowserProxy is dropped, while its tracked sockets are revoked directly.
                    shared.stopping.store(true, Ordering::Release);
                }
            }
            Err(_) => {
                if let Ok(mut clients) = shared.clients.lock() {
                    clients.remove(&id);
                }
                shared.connections.fetch_sub(1, Ordering::AcqRel);
            }
        }
    }
}

fn reap_workers(shared: &Shared) {
    let Ok(mut workers) = shared.workers.lock() else {
        return;
    };
    let mut active = Vec::with_capacity(workers.len());
    for worker in workers.drain(..) {
        if worker.is_finished() {
            let _ = worker.join();
        } else {
            active.push(worker);
        }
    }
    *workers = active;
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        if let Ok(mut clients) = self.shared.clients.lock() {
            clients.remove(&self.id);
        }
        if let Ok(mut daemons) = self.shared.daemons.lock() {
            daemons.remove(&self.id);
        }
        self.shared.connections.fetch_sub(1, Ordering::AcqRel);
    }
}

fn serve(mut client: TcpStream, shared: &Shared, id: u64) -> io::Result<()> {
    client.set_read_timeout(Some(IO_TIMEOUT))?;
    client.set_write_timeout(Some(IO_TIMEOUT))?;
    let (header, client_head) = read_header(&mut client)?;
    let request = parse_connect(&header)?;
    if !constant_time_eq(request.authorization, shared.proxy_authorization.as_bytes()) {
        client.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Happy\"\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    }

    let mut daemon = UnixStream::connect(&shared.socket_path)?;
    if shared.stopping.load(Ordering::Acquire) {
        let _ = daemon.shutdown(Shutdown::Both);
        return Ok(());
    }
    let tracked_daemon = daemon.try_clone()?;
    if let Ok(mut daemons) = shared.daemons.lock() {
        // Couple admission to the stop flag while holding the same lock used by revocation. Thus
        // Drop either observes this tunnel or the worker observes that revocation already began.
        if shared.stopping.load(Ordering::Acquire) {
            let _ = daemon.shutdown(Shutdown::Both);
            return Ok(());
        }
        daemons.insert(id, tracked_daemon);
    } else {
        let _ = daemon.shutdown(Shutdown::Both);
        return Ok(());
    }
    daemon.set_read_timeout(Some(IO_TIMEOUT))?;
    daemon.set_write_timeout(Some(IO_TIMEOUT))?;
    write!(
        daemon,
        "CONNECT {} HTTP/1.1\r\nHost: happy-agent\r\nAuthorization: {}\r\nConnection: close\r\n\r\n",
        shared.workspace_path,
        shared.daemon_authorization.as_str(),
    )?;
    let (daemon_response, daemon_head) = read_header(&mut daemon)?;
    if response_status(&daemon_response) != Some(200) || !daemon_head.is_empty() {
        reject(client, 502, "Bad Gateway");
        return Ok(());
    }

    write!(
        daemon,
        "CONNECT {} HTTP/1.1\r\nHost: {}\r\nConnection: keep-alive\r\n\r\n",
        request.target, request.target,
    )?;
    let (nested_response, nested_head) = read_header(&mut daemon)?;
    if response_status(&nested_response) != Some(200) {
        reject(client, 502, "Bad Gateway");
        return Ok(());
    }
    client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")?;
    if !nested_head.is_empty() {
        client.write_all(&nested_head)?;
    }
    if !client_head.is_empty() {
        daemon.write_all(&client_head)?;
    }
    relay(client, daemon)
}

struct ConnectRequest<'a> {
    target: &'a str,
    authorization: &'a [u8],
}

fn parse_connect(header: &[u8]) -> io::Result<ConnectRequest<'_>> {
    let text = std::str::from_utf8(header).map_err(invalid_request)?;
    let mut lines = text.split("\r\n");
    let request = lines
        .next()
        .ok_or_else(|| invalid_request("missing request"))?;
    let mut parts = request.split(' ');
    if parts.next() != Some("CONNECT") {
        return Err(invalid_request("only CONNECT is accepted"));
    }
    let target = parts
        .next()
        .ok_or_else(|| invalid_request("missing target"))?;
    if parts.next() != Some("HTTP/1.1") || parts.next().is_some() || !valid_target(target) {
        return Err(invalid_request("invalid CONNECT target"));
    }
    let mut authorization = None;
    for line in lines {
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err(invalid_request("invalid header"));
        };
        if name.eq_ignore_ascii_case("proxy-authorization") {
            if authorization.is_some() {
                return Err(invalid_request("duplicate authorization"));
            }
            let value = value.trim().as_bytes();
            if value.len() > MAX_AUTHORIZATION_BYTES {
                return Err(invalid_request("authorization too large"));
            }
            authorization = Some(value);
        }
    }
    Ok(ConnectRequest {
        target,
        authorization: authorization.unwrap_or_default(),
    })
}

fn valid_target(target: &str) -> bool {
    !target.is_empty()
        && target.len() <= MAX_TARGET_BYTES
        && target.bytes().all(|byte| {
            byte.is_ascii_graphic() && !matches!(byte, b'/' | b'\\' | b'@' | b'#' | b'?')
        })
        && target.rsplit_once(':').is_some_and(|(host, port)| {
            !host.is_empty() && port.parse::<u16>().is_ok_and(|port| port != 0)
        })
}

fn constant_time_eq(candidate: &[u8], expected: &[u8]) -> bool {
    let mut difference = candidate.len() ^ expected.len();
    for (index, expected_byte) in expected.iter().enumerate() {
        difference |= usize::from(candidate.get(index).copied().unwrap_or(0) ^ expected_byte);
    }
    difference == 0
}

fn read_header(stream: &mut impl Read) -> io::Result<(Vec<u8>, Vec<u8>)> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    loop {
        let count = stream.read(&mut chunk)?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "connection closed",
            ));
        }
        buffer.extend_from_slice(&chunk[..count]);
        if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            if end + 4 > MAX_HEADER_BYTES {
                return Err(invalid_request("header too large"));
            }
            let head = buffer.split_off(end + 4);
            return Ok((buffer, head));
        }
        if buffer.len() > MAX_HEADER_BYTES {
            return Err(invalid_request("header too large"));
        }
    }
}

fn response_status(header: &[u8]) -> Option<u16> {
    let line = std::str::from_utf8(header).ok()?.split("\r\n").next()?;
    let mut parts = line.split(' ');
    match parts.next()? {
        "HTTP/1.0" | "HTTP/1.1" => parts.next()?.parse().ok(),
        _ => None,
    }
}

fn relay(client: TcpStream, daemon: UnixStream) -> io::Result<()> {
    client.set_read_timeout(None)?;
    client.set_write_timeout(None)?;
    daemon.set_read_timeout(None)?;
    daemon.set_write_timeout(None)?;
    let mut client_read = client.try_clone()?;
    let mut daemon_write = daemon.try_clone()?;
    let forward = thread::Builder::new()
        .name("happy-browser-forward".into())
        .spawn(move || {
            let _ = io::copy(&mut client_read, &mut daemon_write);
            let _ = daemon_write.shutdown(Shutdown::Write);
        })?;
    let mut daemon_read = daemon;
    let mut client_write = client;
    let _ = io::copy(&mut daemon_read, &mut client_write);
    let _ = client_write.shutdown(Shutdown::Write);
    let _ = forward.join();
    Ok(())
}

fn reject(mut stream: TcpStream, status: u16, reason: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    );
    let _ = stream.shutdown(Shutdown::Both);
}

fn random_credential(bytes: usize) -> io::Result<Secret> {
    let mut random = vec![0u8; bytes];
    File::open("/dev/urandom")?.read_exact(&mut random)?;
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&random);
    random.fill(0);
    Ok(Secret::from_bytes(encoded.into_bytes()))
}

fn validate_workspace_id(value: &str) -> io::Result<()> {
    if value.is_empty() || value.len() > 256 || value.contains(['\0', '/']) {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "The browser workspace identity is invalid.",
        ))
    } else {
        Ok(())
    }
}

fn invalid_request(_: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid proxy request.")
}
