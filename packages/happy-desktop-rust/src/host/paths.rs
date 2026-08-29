use serde::Deserialize;
use std::collections::HashSet;
use std::env;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct DaemonPaths {
    pub socket: PathBuf,
    pub token: PathBuf,
    pub binary_config: PathBuf,
    pub versions: PathBuf,
    pub exact: bool,
}

impl DaemonPaths {
    pub fn resolve() -> Result<Self, String> {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "The user home directory is unavailable.".to_owned())?;
        Self::resolve_from(&home, |name| env::var_os(name))
    }

    fn resolve_from(
        home: &Path,
        environment: impl Fn(&str) -> Option<std::ffi::OsString>,
    ) -> Result<Self, String> {
        let explicit_socket = environment("HAPPY_AGENT_SERVER_SOCKET_PATH")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let explicit_token = environment("HAPPY_AGENT_SERVER_TOKEN_PATH")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        match (explicit_socket, explicit_token) {
            (Some(socket), Some(token)) => {
                return Ok(Self {
                    socket,
                    token,
                    binary_config: PathBuf::new(),
                    versions: PathBuf::new(),
                    exact: true,
                });
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err("Both HAPPY_AGENT_SERVER_SOCKET_PATH and HAPPY_AGENT_SERVER_TOKEN_PATH are required for an exact daemon connection.".to_owned());
            }
            (None, None) => {}
        }

        let configured = environment("HAPPY_HOME_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let happy_home = match configured {
            Some(path) if path.is_absolute() => path,
            Some(path) => home.join(path.strip_prefix("~").unwrap_or(&path)),
            None => home.join(".happy"),
        };
        Ok(Self {
            socket: happy_home.join("agent/server.sock"),
            token: happy_home.join("agent/token"),
            binary_config: happy_home.join("dist/config.json"),
            versions: happy_home.join("dist/version"),
            exact: false,
        })
    }

    pub fn selected_binary(&self) -> Result<PathBuf, String> {
        let source = std::fs::read_to_string(&self.binary_config)
            .map_err(|_| "Happy Agent has not been downloaded yet.".to_owned())?;
        let config: BinaryConfig = serde_json::from_str(&source)
            .map_err(|_| "The Happy Agent binary selection is invalid.".to_owned())?;
        if config.downloaded_versions.len() > 100
            || !config
                .downloaded_versions
                .iter()
                .all(|version| semantic_version(version))
            || config
                .downloaded_versions
                .iter()
                .collect::<HashSet<_>>()
                .len()
                != config.downloaded_versions.len()
            || !semantic_version(&config.selected_version)
            || !config
                .downloaded_versions
                .contains(&config.selected_version)
        {
            return Err("The selected Happy Agent version is not completely installed.".to_owned());
        }
        let binary = self
            .versions
            .join(&config.selected_version)
            .join("happy-agent");
        if std::fs::symlink_metadata(&binary)
            .map(|metadata| {
                !metadata.file_type().is_file() || metadata.permissions().mode() & 0o111 == 0
            })
            .unwrap_or(true)
        {
            return Err("The selected Happy Agent binary is missing.".to_owned());
        }
        Ok(binary)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BinaryConfig {
    downloaded_versions: Vec<String>,
    selected_version: String,
}

fn semantic_version(value: &str) -> bool {
    if value.is_empty() || value.len() > 128 || !value.is_ascii() {
        return false;
    }
    let (without_build, build) = value
        .split_once('+')
        .map_or((value, None), |(core, suffix)| (core, Some(suffix)));
    if without_build.contains('+') || build.is_some_and(|suffix| !version_suffix(suffix)) {
        return false;
    }
    let (core, prerelease) = without_build
        .split_once('-')
        .map_or((without_build, None), |(core, suffix)| (core, Some(suffix)));
    if core.contains('-') || prerelease.is_some_and(|suffix| !version_suffix(suffix)) {
        return false;
    }
    let mut parts = core.split('.');
    parts.next().is_some_and(|part| part.parse::<u64>().is_ok())
        && parts.next().is_some_and(|part| part.parse::<u64>().is_ok())
        && parts.next().is_some_and(|part| part.parse::<u64>().is_ok())
        && parts.next().is_none()
}

fn version_suffix(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsString;

    fn resolve(values: &[(&str, &str)]) -> Result<DaemonPaths, String> {
        let values = values
            .iter()
            .map(|(key, value)| ((*key).to_owned(), OsString::from(value)))
            .collect::<HashMap<_, _>>();
        DaemonPaths::resolve_from(Path::new("/Users/happy"), |name| values.get(name).cloned())
    }

    #[test]
    fn default_paths_match_the_shared_happy_agent_contract() {
        let paths = resolve(&[]).unwrap();
        assert_eq!(
            paths.socket,
            Path::new("/Users/happy/.happy/agent/server.sock")
        );
        assert_eq!(paths.token, Path::new("/Users/happy/.happy/agent/token"));
        assert_eq!(
            paths.binary_config,
            Path::new("/Users/happy/.happy/dist/config.json")
        );
        assert!(!paths.exact);
    }

    #[test]
    fn exact_connection_requires_socket_and_token_together() {
        assert!(resolve(&[("HAPPY_AGENT_SERVER_SOCKET_PATH", "/x.sock")]).is_err());
        let paths = resolve(&[
            ("HAPPY_AGENT_SERVER_SOCKET_PATH", "/x.sock"),
            ("HAPPY_AGENT_SERVER_TOKEN_PATH", "/x.token"),
        ])
        .unwrap();
        assert!(paths.exact);
        assert_eq!(paths.socket, Path::new("/x.sock"));
    }

    #[test]
    fn semantic_versions_cannot_escape_the_managed_versions_directory() {
        assert!(semantic_version("1.2.3-beta.1+mac.arm64"));
        assert!(!semantic_version("1.2.3+../../outside"));
        assert!(!semantic_version("1.2"));
        assert!(!semantic_version("1.2.3+"));
    }
}
