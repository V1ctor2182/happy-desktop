use super::http::UnixHttpClient;
use super::paths::DaemonPaths;
use crate::state::runtime::{BootstrapSnapshot, HealthSnapshot};
use getrandom::fill;
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug)]
pub struct HostError(String);

impl fmt::Display for HostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for HostError {}

struct HostAuthority {
    socket: PathBuf,
    token: String,
    capability: [u8; 32],
}

/// Restricted client passed across the native host/product-state boundary.
///
/// Its fields are private by design: product state can request typed protocol resources but cannot
/// extract the bearer credential or address the daemon through an arbitrary endpoint.
#[derive(Clone)]
pub struct AuthenticatedClient {
    authority: Arc<HostAuthority>,
    presented_capability: [u8; 32],
}

impl AuthenticatedClient {
    pub fn health(&self) -> Result<HealthSnapshot, HostError> {
        self.get_json("/v0/health")
    }

    pub fn bootstrap(&self) -> Result<BootstrapSnapshot, HostError> {
        self.get_json("/v0/bootstrap/desktop")
    }

    fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, HostError> {
        if !constant_time_equal(&self.presented_capability, &self.authority.capability) {
            return Err(HostError(
                "The Happy Agent capability is invalid.".to_owned(),
            ));
        }
        let body = UnixHttpClient::get(&self.authority.socket, &self.authority.token, path)
            .map_err(HostError)?;
        serde_json::from_slice(&body).map_err(|error| {
            HostError(format!("Happy Agent returned invalid {path} data: {error}"))
        })
    }
}

pub struct HostRuntime {
    client: AuthenticatedClient,
}

impl HostRuntime {
    pub fn connect() -> Result<Self, HostError> {
        let paths = DaemonPaths::resolve().map_err(HostError)?;
        if let Some(runtime) = Self::attach(&paths)? {
            return Ok(runtime);
        }
        // A token/socket pair can appear before the daemon becomes ready. Wait on that exact
        // endpoint rather than racing it with another `start` invocation.
        if (paths.exact || paths.token.is_file() && paths.socket.exists())
            && let Some(runtime) = Self::wait_for_attach(&paths, Duration::from_secs(10))?
        {
            return Ok(runtime);
        }
        if paths.exact {
            return Err(HostError(format!(
                "Could not reach the exact Happy Agent daemon at {}.",
                paths.socket.display()
            )));
        }
        let binary = paths.selected_binary().map_err(HostError)?;
        start_daemon(&binary)?;
        if let Some(runtime) = Self::wait_for_attach(&paths, Duration::from_secs(10))? {
            return Ok(runtime);
        }
        Err(HostError(
            "Timed out while waiting for Happy Agent.".to_owned(),
        ))
    }

    fn wait_for_attach(paths: &DaemonPaths, timeout: Duration) -> Result<Option<Self>, HostError> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let Some(runtime) = Self::attach(paths)? {
                return Ok(Some(runtime));
            }
            thread::sleep(Duration::from_millis(50));
        }
        Ok(None)
    }

    pub fn bootstrap(&self) -> Result<BootstrapSnapshot, HostError> {
        self.client.bootstrap()
    }

    pub fn client(&self) -> AuthenticatedClient {
        self.client.clone()
    }

    fn attach(paths: &DaemonPaths) -> Result<Option<Self>, HostError> {
        let token = match std::fs::read_to_string(&paths.token) {
            Ok(token) if !token.trim().is_empty() => token.trim().to_owned(),
            _ => return Ok(None),
        };
        let mut capability = [0_u8; 32];
        fill(&mut capability)
            .map_err(|error| HostError(format!("Could not create a host capability: {error}")))?;
        let authority = Arc::new(HostAuthority {
            socket: paths.socket.clone(),
            token,
            capability,
        });
        let client = AuthenticatedClient {
            authority,
            presented_capability: capability,
        };
        let health = match client.health() {
            Ok(health) => health,
            Err(_) => return Ok(None),
        };
        if health.version.protocol != 23 {
            return Err(HostError(format!(
                "Happy Agent protocol {} is incompatible with protocol 23.",
                health.version.protocol
            )));
        }
        if !health.ready {
            return Ok(None);
        }
        Ok(Some(Self { client }))
    }
}

fn start_daemon(binary: &Path) -> Result<(), HostError> {
    let environment = login_environment().unwrap_or_else(|| std::env::vars_os().collect());
    let output = Command::new(binary)
        .arg("start")
        .env_clear()
        .envs(environment)
        .output()
        .map_err(|error| HostError(format!("Happy Agent could not be started: {error}")))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        Err(HostError(if detail.is_empty() {
            "Happy Agent could not be started.".to_owned()
        } else {
            format!("Happy Agent could not be started: {detail}")
        }))
    }
}

fn login_environment() -> Option<Vec<(std::ffi::OsString, std::ffi::OsString)>> {
    let shell = std::env::var_os("SHELL")?;
    if !Path::new(&shell).is_absolute() {
        return None;
    }
    let output = Command::new(shell)
        .args(["-l", "-i", "-c", "/usr/bin/env -0"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let environment = output
        .stdout
        .split(|byte| *byte == 0)
        .filter_map(|record| {
            let separator = record.iter().position(|byte| *byte == b'=')?;
            let key =
                std::ffi::OsString::from(String::from_utf8_lossy(&record[..separator]).as_ref());
            let value = std::ffi::OsString::from(
                String::from_utf8_lossy(&record[separator + 1..]).as_ref(),
            );
            Some((key, value))
        })
        .collect::<Vec<_>>();
    environment
        .iter()
        .any(|(key, _)| key == "PATH")
        .then_some(environment)
}

fn constant_time_equal(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_check_compares_every_byte() {
        let allowed = [7_u8; 32];
        assert!(constant_time_equal(&allowed, &allowed));
        let mut refused = allowed;
        refused[31] = 8;
        assert!(!constant_time_equal(&allowed, &refused));
    }
}
