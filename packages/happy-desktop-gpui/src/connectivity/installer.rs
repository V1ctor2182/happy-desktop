//! Secure, synchronous installer for the Happy-managed local Happy Agent.
//!
//! This module intentionally owns only installation and process launch. It does
//! not read the daemon token or connect to the daemon.

use std::{
    collections::HashMap,
    env,
    error::Error,
    ffi::OsString,
    fmt,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime},
};

#[cfg(target_os = "macos")]
use std::{ffi::CString, os::unix::ffi::OsStrExt};

use flate2::read::GzDecoder;
use regex::Regex;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/slopus/happy-agent/releases/latest";
const USER_AGENT: &str = "Happy Desktop Happy Agent downloader";
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_BINARY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const LOCK_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const LOCK_GRACE: Duration = Duration::from_secs(5);
const LOCK_POLL: Duration = Duration::from_millis(100);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_SHELL_OUTPUT: usize = 1024 * 1024;
const SEMVER: &str = r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$";

#[derive(Debug)]
pub struct InstallerError {
    message: String,
    source: Option<Box<dyn Error + Send + Sync>>,
}

impl InstallerError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            source: None,
        }
    }

    fn with_source(message: impl Into<String>, source: impl Error + Send + Sync + 'static) -> Self {
        Self {
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }
}

impl fmt::Display for InstallerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for InstallerError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.source
            .as_deref()
            .map(|source| source as &(dyn Error + 'static))
    }
}

type Result<T> = std::result::Result<T, InstallerError>;

#[derive(Clone, Debug)]
#[allow(dead_code)] // The complete lifecycle contract is retained for restart/update phases.
pub struct HappyDaemonPaths {
    pub happy_home: PathBuf,
    pub agent_directory: PathBuf,
    pub dist_directory: PathBuf,
    pub versions_directory: PathBuf,
    pub binary_config_path: PathBuf,
    pub install_lock_path: PathBuf,
    pub log_path: PathBuf,
    pub socket_path: PathBuf,
    pub token_path: PathBuf,
}

pub fn happy_home_resolve(configured: Option<&str>, home: &Path) -> PathBuf {
    let configured = configured.map(str::trim).filter(|value| !value.is_empty());
    match configured {
        None => home.join(".happy"),
        Some(value) if value.starts_with('~') => {
            home.join(value.trim_start_matches('~').trim_start_matches('/'))
        }
        Some(value) if Path::new(value).is_absolute() => PathBuf::from(value),
        Some(value) => home.join(value),
    }
}

impl HappyDaemonPaths {
    /// Matches `happyAgentBinaryPaths.ts`, including `HAPPY_HOME_DIR` expansion.
    pub fn resolve(environment: &HashMap<OsString, OsString>, home: &Path) -> Self {
        let configured = environment
            .get(&OsString::from("HAPPY_HOME_DIR"))
            .and_then(|value| value.to_str());
        let happy_home = happy_home_resolve(configured, home);
        let agent_directory = happy_home.join("agent");
        let dist_directory = happy_home.join("dist");
        Self {
            versions_directory: dist_directory.join("version"),
            binary_config_path: dist_directory.join("config.json"),
            install_lock_path: dist_directory.join("install.lock"),
            log_path: agent_directory.join("daemon.log"),
            socket_path: agent_directory.join("server.sock"),
            token_path: agent_directory.join("token"),
            happy_home,
            agent_directory,
            dist_directory,
        }
    }

    pub fn binary_path(&self, version: &str) -> PathBuf {
        self.versions_directory.join(version).join("happy-agent")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TargetArchitecture {
    Arm64,
    X64,
}

impl TargetArchitecture {
    pub fn native() -> Result<Self> {
        match env::consts::ARCH {
            "aarch64" => Ok(Self::Arm64),
            "x86_64" => Ok(Self::X64),
            architecture => Err(InstallerError::new(format!(
                "Happy Agent does not publish a binary for darwin-{architecture}."
            ))),
        }
    }

    fn release_name(self) -> &'static str {
        match self {
            Self::Arm64 => "arm64",
            Self::X64 => "x64",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DaemonCommand {
    Start,
    Reload,
    None,
}

#[derive(Clone, Debug)]
pub struct InstallOptions {
    pub architecture: TargetArchitecture,
    /// Environment inherited by the GUI process. Only the safe shell bootstrap
    /// subset is passed to the login shell; its resulting environment starts the daemon.
    pub base_environment: HashMap<OsString, OsString>,
    pub shell: PathBuf,
    pub daemon_command: DaemonCommand,
    pub command_timeout: Duration,
    pub resolved_environment: Option<HashMap<OsString, OsString>>,
}

impl InstallOptions {
    pub fn native(shell: PathBuf) -> Result<Self> {
        Ok(Self {
            architecture: TargetArchitecture::native()?,
            base_environment: env::vars_os().collect(),
            shell,
            daemon_command: DaemonCommand::Start,
            command_timeout: COMMAND_TIMEOUT,
            resolved_environment: None,
        })
    }
}

#[derive(Clone, Debug)]
pub enum InstallProgress {
    Status(String),
    Download {
        received_bytes: u64,
        total_bytes: u64,
    },
}

#[derive(Clone, Debug)]
pub struct InstalledHappyAgent {
    pub path: PathBuf,
    pub version: String,
}

#[derive(Deserialize)]
struct ReleaseAsset {
    browser_download_url: String,
    digest: Option<String>,
    name: String,
    size: u64,
}

#[derive(Deserialize)]
struct Release {
    assets: Vec<ReleaseAsset>,
    draft: bool,
    #[allow(dead_code)]
    prerelease: bool,
    tag_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct InstallLockRecord {
    pid: u32,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BinaryConfig {
    downloaded_versions: Vec<String>,
    selected_version: String,
}

/// Downloads, validates, installs, selects, and optionally starts the latest release.
///
/// The callback never receives daemon credentials. This function never reads the
/// token file, so a caller cannot accidentally log the token through progress.
pub fn install_latest(
    options: &InstallOptions,
    paths: &HappyDaemonPaths,
    mut progress: impl FnMut(InstallProgress),
) -> Result<InstalledHappyAgent> {
    if env::consts::OS != "macos" {
        return Err(InstallerError::new(
            "The native Happy Agent installer supports macOS only.",
        ));
    }
    secure_directory(&paths.dist_directory)?;
    secure_directory(&paths.versions_directory)?;

    progress(InstallProgress::Status(
        "Checking for the latest Happy Agent.".into(),
    ));
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| {
            InstallerError::with_source("Could not create the Happy Agent downloader.", error)
        })?;
    let release = latest_release(&client, options.architecture)?;
    let installed = {
        let _lock = InstallLock::acquire(&paths.install_lock_path, &mut progress)?;
        let final_path = paths.binary_path(&release.version);
        // Never trust an executable merely because it already occupies the release
        // path. Rebuild the selected version from the archive whose GitHub digest
        // was validated in this invocation before any binary can be launched.
        progress(InstallProgress::Status(format!(
            "Downloading Happy Agent {}.",
            release.version
        )));
        install_release(&client, &release, paths, &mut progress)?;
        write_selected_config(paths, &release.version)?;
        InstalledHappyAgent {
            path: final_path,
            version: release.version,
        }
    };

    if options.daemon_command != DaemonCommand::None {
        progress(InstallProgress::Status(
            match options.daemon_command {
                DaemonCommand::Start => "Starting Happy Agent.",
                DaemonCommand::Reload => "Reloading Happy Agent.",
                DaemonCommand::None => unreachable!(),
            }
            .into(),
        ));
        let environment = install_environment(options)?;
        run_daemon_command(
            &installed.path,
            options.daemon_command,
            &environment,
            options.command_timeout,
        )?;
    }
    Ok(installed)
}

struct ResolvedRelease {
    asset: ReleaseAsset,
    archived_binary_name: String,
    version: String,
}

fn latest_release(client: &Client, architecture: TargetArchitecture) -> Result<ResolvedRelease> {
    let response = client
        .get(LATEST_RELEASE_URL)
        .header("accept", "application/vnd.github+json")
        .header("x-github-api-version", "2022-11-28")
        .timeout(LOOKUP_TIMEOUT)
        .send()
        .map_err(|error| {
            InstallerError::with_source("Could not check for the latest Happy Agent.", error)
        })?;
    require_https_response(&response, "Happy Agent release lookup")?;
    if !response.status().is_success() {
        return Err(InstallerError::new(format!(
            "GitHub returned HTTP {} while checking for Happy Agent.",
            response.status().as_u16()
        )));
    }
    let release: Release = response.json().map_err(|error| {
        InstallerError::with_source("GitHub returned an invalid Happy Agent release.", error)
    })?;
    validate_and_resolve_release(release, architecture)
}

fn validate_and_resolve_release(
    release: Release,
    architecture: TargetArchitecture,
) -> Result<ResolvedRelease> {
    if release.draft
        || release.tag_name.len() < 2
        || release.tag_name.len() > 129
        || release.assets.len() > 100
    {
        return Err(InstallerError::new(
            "GitHub returned an invalid Happy Agent release.",
        ));
    }
    for asset in &release.assets {
        validate_asset(asset)?;
        require_https_url(
            &asset.browser_download_url,
            "GitHub returned an insecure Happy Agent release URL.",
        )?;
    }
    let version = release.tag_name.strip_prefix('v').ok_or_else(|| {
        InstallerError::new(format!(
            "A Happy Agent release tag is invalid: {}",
            release.tag_name
        ))
    })?;
    if version.len() > 128
        || !Regex::new(SEMVER)
            .expect("constant regex")
            .is_match(version)
    {
        return Err(InstallerError::new(format!(
            "A Happy Agent release tag is invalid: {}",
            release.tag_name
        )));
    }
    let target = format!("darwin-{}", architecture.release_name());
    let asset_name = format!("happy-agent-{version}-{target}.tar.gz");
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| {
            InstallerError::new(format!(
                "Happy Agent {version} has no release for {target}."
            ))
        })?;
    if asset.digest.is_none() {
        return Err(InstallerError::new(format!(
            "Happy Agent {version} does not publish a checksum for {target}."
        )));
    }
    Ok(ResolvedRelease {
        asset,
        archived_binary_name: format!("happy-agent-{target}"),
        version: version.to_owned(),
    })
}

fn validate_asset(asset: &ReleaseAsset) -> Result<()> {
    let digest_valid = asset.digest.as_deref().is_none_or(|digest| {
        digest.len() == 71
            && digest.starts_with("sha256:")
            && digest[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
    });
    if asset.browser_download_url.is_empty()
        || asset.browser_download_url.len() > 2048
        || asset.name.is_empty()
        || asset.name.len() > 256
        || asset.size == 0
        || asset.size > MAX_ARCHIVE_BYTES
        || !digest_valid
    {
        return Err(InstallerError::new(
            "GitHub returned an invalid Happy Agent release.",
        ));
    }
    Ok(())
}

fn require_https_url(url: &str, message: &str) -> Result<()> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| InstallerError::new("GitHub returned an invalid Happy Agent release URL."))?;
    if parsed.scheme() != "https" {
        return Err(InstallerError::new(message));
    }
    Ok(())
}

fn require_https_response(response: &Response, label: &str) -> Result<()> {
    if response.url().scheme() != "https" {
        return Err(InstallerError::new(format!(
            "{label} redirected to an insecure URL."
        )));
    }
    Ok(())
}

fn install_release(
    client: &Client,
    release: &ResolvedRelease,
    paths: &HappyDaemonPaths,
    progress: &mut impl FnMut(InstallProgress),
) -> Result<()> {
    let staging = unique_path(&paths.versions_directory, ".install-")?;
    fs::create_dir(&staging).map_err(|error| {
        InstallerError::with_source("Could not create the Happy Agent staging directory.", error)
    })?;
    set_mode(&staging, 0o700)?;
    let result = (|| {
        let archive_path = staging.join("happy-agent.tar.gz");
        download_archive(client, &release.asset, &archive_path, progress)?;
        let normalized = staging.join("happy-agent");
        extract_one_binary(&archive_path, &normalized, &release.archived_binary_name)?;
        fs::remove_file(&archive_path).map_err(|error| {
            InstallerError::with_source("Could not remove the Happy Agent archive.", error)
        })?;
        set_mode(&normalized, 0o700)?;
        File::open(&normalized)
            .and_then(|file| file.sync_all())
            .map_err(|error| {
                InstallerError::with_source("Could not sync the Happy Agent binary.", error)
            })?;
        let final_directory = paths.versions_directory.join(&release.version);
        // Keep any unverified cached copy in place until the replacement has
        // been fully downloaded, digest-verified, extracted, synced, and made
        // executable. A macOS atomic exchange leaves the displaced directory at
        // `staging`; only remove it after the new final name is directory-synced.
        let displaced = publish_release(&staging, &final_directory)?;
        sync_directory(&paths.versions_directory)?;
        if displaced {
            remove_any(&staging)?;
            sync_directory(&paths.versions_directory)?;
        }
        Ok(())
    })();
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

#[cfg(target_os = "macos")]
fn publish_release(staging: &Path, final_directory: &Path) -> Result<bool> {
    match fs::symlink_metadata(final_directory) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::rename(staging, final_directory).map_err(|error| {
                InstallerError::with_source(
                    "Could not atomically install the Happy Agent release.",
                    error,
                )
            })?;
            Ok(false)
        }
        Err(error) => Err(InstallerError::with_source(
            "Could not inspect the selected Happy Agent release.",
            error,
        )),
        Ok(_) => {
            let staging = CString::new(staging.as_os_str().as_bytes())
                .map_err(|_| InstallerError::new("The Happy Agent staging path is invalid."))?;
            let final_directory = CString::new(final_directory.as_os_str().as_bytes())
                .map_err(|_| InstallerError::new("The Happy Agent release path is invalid."))?;
            // SAFETY: both C strings remain alive for the call, AT_FDCWD makes
            // them normal absolute paths, and RENAME_SWAP changes only names on
            // the same filesystem without exposing a missing final path.
            let result = unsafe {
                libc::renameatx_np(
                    libc::AT_FDCWD,
                    staging.as_ptr(),
                    libc::AT_FDCWD,
                    final_directory.as_ptr(),
                    libc::RENAME_SWAP,
                )
            };
            if result != 0 {
                return Err(InstallerError::with_source(
                    "Could not atomically replace the Happy Agent release.",
                    io::Error::last_os_error(),
                ));
            }
            Ok(true)
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn publish_release(staging: &Path, final_directory: &Path) -> Result<bool> {
    match fs::symlink_metadata(final_directory) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::rename(staging, final_directory).map_err(|error| {
                InstallerError::with_source(
                    "Could not atomically install the Happy Agent release.",
                    error,
                )
            })?;
            Ok(false)
        }
        Err(error) => Err(InstallerError::with_source(
            "Could not inspect the selected Happy Agent release.",
            error,
        )),
        Ok(_) => Err(InstallerError::new(
            "This platform cannot atomically replace an existing Happy Agent release.",
        )),
    }
}

fn download_archive(
    client: &Client,
    asset: &ReleaseAsset,
    destination: &Path,
    progress: &mut impl FnMut(InstallProgress),
) -> Result<()> {
    let mut response = client
        .get(&asset.browser_download_url)
        .header("accept", "application/octet-stream")
        .timeout(DOWNLOAD_TIMEOUT)
        .send()
        .map_err(|error| InstallerError::with_source("Could not download Happy Agent.", error))?;
    require_https_response(&response, "Happy Agent release download")?;
    if !response.status().is_success() {
        return Err(InstallerError::new(format!(
            "GitHub returned HTTP {} while downloading Happy Agent.",
            response.status().as_u16()
        )));
    }
    let expected = asset
        .digest
        .as_deref()
        .and_then(|value| value.strip_prefix("sha256:"))
        .ok_or_else(|| InstallerError::new("The Happy Agent checksum is missing."))?
        .to_ascii_lowercase();
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(destination)
        .map_err(|error| {
            InstallerError::with_source("Could not create the Happy Agent archive.", error)
        })?;
    let mut hash = Sha256::new();
    let mut received = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = response.read(&mut buffer).map_err(|error| {
            InstallerError::with_source("Could not read the Happy Agent download.", error)
        })?;
        if count == 0 {
            break;
        }
        received = received.checked_add(count as u64).ok_or_else(|| {
            InstallerError::new("The Happy Agent release archive is larger than declared.")
        })?;
        if received > MAX_ARCHIVE_BYTES || received > asset.size {
            return Err(InstallerError::new(
                "The Happy Agent release archive is larger than declared.",
            ));
        }
        hash.update(&buffer[..count]);
        output.write_all(&buffer[..count]).map_err(|error| {
            InstallerError::with_source("Could not write the Happy Agent archive.", error)
        })?;
        progress(InstallProgress::Download {
            received_bytes: received,
            total_bytes: asset.size,
        });
    }
    output.sync_all().map_err(|error| {
        InstallerError::with_source("Could not sync the Happy Agent archive.", error)
    })?;
    if received != asset.size {
        return Err(InstallerError::new(
            "The Happy Agent release archive size does not match its manifest.",
        ));
    }
    if format!("{:x}", hash.finalize()) != expected {
        return Err(InstallerError::new(
            "The Happy Agent release archive checksum does not match.",
        ));
    }
    Ok(())
}

fn extract_one_binary(archive_path: &Path, destination: &Path, expected_name: &str) -> Result<()> {
    let archive_file = File::open(archive_path).map_err(|error| {
        InstallerError::with_source("Could not open the Happy Agent archive.", error)
    })?;
    let mut archive = tar::Archive::new(GzDecoder::new(archive_file));
    let mut entries = archive.entries().map_err(|error| {
        InstallerError::with_source("The Happy Agent release archive is invalid.", error)
    })?;
    let mut entry = entries
        .next()
        .transpose()
        .map_err(|error| {
            InstallerError::with_source("The Happy Agent release archive is invalid.", error)
        })?
        .ok_or_else(|| {
            InstallerError::new("The Happy Agent release archive has unexpected contents.")
        })?;
    let path = entry.path().map_err(|error| {
        InstallerError::with_source(
            "The Happy Agent release archive has an invalid path.",
            error,
        )
    })?;
    if path.components().count() != 1
        || path.components().next() != Some(Component::Normal(expected_name.as_ref()))
        || !entry.header().entry_type().is_file()
    {
        return Err(InstallerError::new(
            "The Happy Agent release archive has unexpected contents.",
        ));
    }
    let declared = entry.header().size().map_err(|error| {
        InstallerError::with_source("The Happy Agent release binary has an invalid size.", error)
    })?;
    if declared == 0 || declared > MAX_BINARY_BYTES {
        return Err(InstallerError::new(
            "The Happy Agent release did not contain a binary.",
        ));
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(destination)
        .map_err(|error| {
            InstallerError::with_source("Could not create the staged Happy Agent binary.", error)
        })?;
    let copied =
        io::copy(&mut entry.by_ref().take(MAX_BINARY_BYTES + 1), &mut output).map_err(|error| {
            InstallerError::with_source("Could not extract the Happy Agent binary.", error)
        })?;
    if copied != declared || copied == 0 || copied > MAX_BINARY_BYTES {
        return Err(InstallerError::new(
            "The Happy Agent release did not contain a binary.",
        ));
    }
    drop(entry);
    if entries
        .next()
        .transpose()
        .map_err(|error| {
            InstallerError::with_source("The Happy Agent release archive is invalid.", error)
        })?
        .is_some()
    {
        return Err(InstallerError::new(
            "The Happy Agent release archive has unexpected contents.",
        ));
    }
    output.sync_all().map_err(|error| {
        InstallerError::with_source("Could not sync the staged Happy Agent binary.", error)
    })?;
    Ok(())
}

fn write_selected_config(paths: &HappyDaemonPaths, selected: &str) -> Result<()> {
    let downloaded_versions = downloaded_versions(paths)?;
    if !downloaded_versions
        .iter()
        .any(|version| version == selected)
    {
        return Err(InstallerError::new(format!(
            "Happy Agent {selected} is not completely installed."
        )));
    }
    if downloaded_versions.len() > 100 {
        return Err(InstallerError::new(
            "The downloaded Happy Agent versions could not be recorded.",
        ));
    }
    let config = BinaryConfig {
        downloaded_versions,
        selected_version: selected.to_owned(),
    };
    let mut bytes = serde_json::to_vec_pretty(&config).map_err(|error| {
        InstallerError::with_source(
            "The downloaded Happy Agent versions could not be recorded.",
            error,
        )
    })?;
    bytes.push(b'\n');
    let temporary = unique_path(
        &paths.dist_directory,
        &format!("config.json.{}.", std::process::id()),
    )?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|error| {
                InstallerError::with_source(
                    "Could not create the Happy Agent configuration.",
                    error,
                )
            })?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| {
                InstallerError::with_source("Could not write the Happy Agent configuration.", error)
            })?;
        set_mode(&temporary, 0o600)?;
        fs::rename(&temporary, &paths.binary_config_path).map_err(|error| {
            InstallerError::with_source("Could not select the Happy Agent release.", error)
        })?;
        set_mode(&paths.binary_config_path, 0o600)?;
        sync_directory(&paths.dist_directory)
    })();
    if temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn downloaded_versions(paths: &HappyDaemonPaths) -> Result<Vec<String>> {
    let semver = Regex::new(SEMVER).expect("constant regex");
    let mut versions = Vec::new();
    let entries = fs::read_dir(&paths.versions_directory).map_err(|error| {
        InstallerError::with_source("Could not list installed Happy Agent versions.", error)
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            InstallerError::with_source("Could not read an installed Happy Agent version.", error)
        })?;
        let name = match entry.file_name().into_string() {
            Ok(name) => name,
            Err(_) => continue,
        };
        if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
            && name.len() <= 128
            && semver.is_match(&name)
            && executable_file(&paths.binary_path(&name))
        {
            versions.push(name);
        }
    }
    versions.sort();
    Ok(versions)
}

struct InstallLockGuard {
    file: File,
}

impl InstallLockGuard {
    fn try_acquire(lock_path: &Path) -> Result<Option<Self>> {
        let guard_path = lock_path.with_extension("lock.guard");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .open(&guard_path)
            .map_err(|error| {
                InstallerError::with_source("Could not open the Happy Agent install guard.", error)
            })?;
        set_mode(&guard_path, 0o600)?;
        // SAFETY: flock operates on this owned, open file descriptor. Nonblocking
        // acquisition keeps all waiting inside the install lock's bounded loop.
        let result = unsafe {
            libc::flock(
                std::os::fd::AsRawFd::as_raw_fd(&file),
                libc::LOCK_EX | libc::LOCK_NB,
            )
        };
        if result == 0 {
            return Ok(Some(Self { file }));
        }
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::WouldBlock {
            return Ok(None);
        }
        Err(InstallerError::with_source(
            "Could not acquire the Happy Agent install guard.",
            error,
        ))
    }
}

impl Drop for InstallLockGuard {
    fn drop(&mut self) {
        // SAFETY: this unlocks only the descriptor locked by `acquire`.
        unsafe {
            libc::flock(std::os::fd::AsRawFd::as_raw_fd(&self.file), libc::LOCK_UN);
        }
    }
}

struct InstallLock {
    path: PathBuf,
    token: String,
    _file: File,
}

impl InstallLock {
    fn acquire(path: &Path, progress: &mut impl FnMut(InstallProgress)) -> Result<Self> {
        let record = InstallLockRecord {
            pid: std::process::id(),
            token: random_token()?,
        };
        let serialized = serde_json::to_vec(&record).map_err(|error| {
            InstallerError::with_source("Could not create the Happy Agent install lock.", error)
        })?;
        let deadline = Instant::now() + LOCK_TIMEOUT;
        let mut announced = false;
        loop {
            let Some(_guard) = InstallLockGuard::try_acquire(path)? else {
                if !announced {
                    progress(InstallProgress::Status(
                        "Waiting for another process to finish downloading Happy Agent.".into(),
                    ));
                    announced = true;
                }
                if Instant::now() >= deadline {
                    return Err(InstallerError::new(
                        "Timed out waiting for another process to install Happy Agent.",
                    ));
                }
                thread::sleep(LOCK_POLL);
                continue;
            };
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(path)
            {
                Ok(mut file) => {
                    if let Err(error) = file.write_all(&serialized).and_then(|_| file.sync_all()) {
                        let _ = fs::remove_file(path);
                        return Err(InstallerError::with_source(
                            "Could not write the Happy Agent install lock.",
                            error,
                        ));
                    }
                    if let Err(error) = set_mode(path, 0o600) {
                        drop(file);
                        let _ = fs::remove_file(path);
                        return Err(error);
                    }
                    return Ok(Self {
                        path: path.to_owned(),
                        token: record.token,
                        _file: file,
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => {
                    return Err(InstallerError::with_source(
                        "Could not acquire the Happy Agent install lock.",
                        error,
                    ));
                }
            }
            if !announced {
                progress(InstallProgress::Status(
                    "Waiting for another process to finish downloading Happy Agent.".into(),
                ));
                announced = true;
            }
            if stale_lock(path)? {
                remove_stale_lock(path)?;
                continue;
            }
            if Instant::now() >= deadline {
                return Err(InstallerError::new(
                    "Timed out waiting for another process to install Happy Agent.",
                ));
            }
            thread::sleep(LOCK_POLL);
        }
    }
}

impl Drop for InstallLock {
    fn drop(&mut self) {
        if read_lock(&self.path)
            .as_ref()
            .is_some_and(|record| record.token == self.token)
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn stale_lock(path: &Path) -> Result<bool> {
    if let Some(record) = read_lock(path) {
        return Ok(!process_exists(record.pid));
    }
    let age = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok());
    Ok(age.is_some_and(|age| age >= LOCK_GRACE))
}

fn remove_stale_lock(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(InstallerError::with_source(
            "Could not remove a stale Happy Agent install lock.",
            error,
        )),
    }
}

fn read_lock(path: &Path) -> Option<InstallLockRecord> {
    let bytes = fs::read(path).ok()?;
    let record: InstallLockRecord = serde_json::from_slice(&bytes).ok()?;
    if record.pid == 0
        || record.pid > i32::MAX as u32
        || record.token.is_empty()
        || record.token.len() > 128
    {
        return None;
    }
    Some(record)
}

fn process_exists(pid: u32) -> bool {
    // SAFETY: kill(pid, 0) sends no signal. The pid is range-checked by read_lock.
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

fn install_environment(options: &InstallOptions) -> Result<HashMap<OsString, OsString>> {
    if let Some(environment) = &options.resolved_environment {
        Ok(environment.clone())
    } else {
        capture_login_shell_environment(
            &options.shell,
            &options.base_environment,
            options.command_timeout,
        )
    }
}

pub fn capture_login_shell_environment(
    shell: &Path,
    base_environment: &HashMap<OsString, OsString>,
    timeout: Duration,
) -> Result<HashMap<OsString, OsString>> {
    if !shell.is_absolute() {
        return Err(InstallerError::new(
            "The user's configured login shell is unavailable.",
        ));
    }
    let command = "printf '__HAPPY_ENV__\\0'; /usr/bin/env -0";
    let output = run_capture_bounded(
        shell,
        &["-l", "-i", "-c", command],
        base_environment,
        timeout,
        MAX_SHELL_OUTPUT,
    )?;
    let marker = b"__HAPPY_ENV__\0";
    let start = output
        .windows(marker.len())
        .position(|window| window == marker)
        .map(|index| index + marker.len())
        .ok_or_else(|| {
            InstallerError::new(
                "The login shell did not return a machine-readable Happy Agent environment.",
            )
        })?;
    let mut environment = HashMap::new();
    for record in output[start..].split(|byte| *byte == 0) {
        if let Some(separator) = record.iter().position(|byte| *byte == b'=') {
            if separator > 0 && environment_key_valid(&record[..separator]) {
                use std::os::unix::ffi::OsStringExt;
                environment.insert(
                    OsString::from_vec(record[..separator].to_vec()),
                    OsString::from_vec(record[separator + 1..].to_vec()),
                );
            }
        }
    }
    if !environment.contains_key(&OsString::from("PATH")) {
        return Err(InstallerError::new(
            "The login shell environment did not include PATH.",
        ));
    }
    Ok(environment)
}

fn environment_key_valid(key: &[u8]) -> bool {
    key.first()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'_')
        && key[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
}

fn run_capture_bounded(
    executable: &Path,
    arguments: &[&str],
    base_environment: &HashMap<OsString, OsString>,
    timeout: Duration,
    maximum: usize,
) -> Result<Vec<u8>> {
    let mut command = Command::new(executable);
    command.args(arguments).env_clear();
    for key in [
        "HOME",
        "HAPPY_HOME_DIR",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TMPDIR",
        "USER",
    ] {
        if let Some(value) = base_environment.get(&OsString::from(key)) {
            command.env(key, value);
        }
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            InstallerError::with_source("Could not run the user's login shell.", error)
        })?;
    let stdout = child.stdout.take().expect("piped stdout");
    let reader = thread::spawn(move || -> io::Result<(Vec<u8>, bool)> {
        let mut reader = stdout;
        let mut kept = Vec::new();
        let mut too_large = false;
        let mut buffer = [0u8; 8192];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            let room = maximum.saturating_sub(kept.len());
            kept.extend_from_slice(&buffer[..count.min(room)]);
            if count > room {
                too_large = true;
            }
        }
        Ok((kept, too_large))
    });
    wait_child(&mut child, timeout, "The user's login shell timed out.")?;
    let (output, too_large) = reader
        .join()
        .map_err(|_| InstallerError::new("The user's login shell output reader failed."))?
        .map_err(|error| {
            InstallerError::with_source("Could not read the user's login shell.", error)
        })?;
    if too_large {
        return Err(InstallerError::new(
            "The user's login shell returned too much output.",
        ));
    }
    Ok(output)
}

fn run_daemon_command(
    binary: &Path,
    command: DaemonCommand,
    environment: &HashMap<OsString, OsString>,
    timeout: Duration,
) -> Result<()> {
    let argument = match command {
        DaemonCommand::Start => "start",
        DaemonCommand::Reload => "reload",
        DaemonCommand::None => return Ok(()),
    };
    let mut child = Command::new(binary)
        .arg(argument)
        .env_clear()
        .envs(environment)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            InstallerError::with_source(format!("Could not {argument} Happy Agent."), error)
        })?;
    wait_child(&mut child, timeout, "Timed out while starting Happy Agent.")
}

fn wait_child(
    child: &mut std::process::Child,
    timeout: Duration,
    timeout_message: &str,
) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            InstallerError::with_source("Could not wait for the Happy Agent command.", error)
        })? {
            return if status.success() {
                Ok(())
            } else {
                Err(InstallerError::new(format!(
                    "The Happy Agent command exited with {status}."
                )))
            };
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(InstallerError::new(timeout_message));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn secure_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path).map_err(|error| {
        InstallerError::with_source(format!("Could not create {}.", path.display()), error)
    })?;
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        InstallerError::with_source("Could not inspect a Happy Agent directory.", error)
    })?;
    if !metadata.file_type().is_dir() {
        return Err(InstallerError::new(format!(
            "{} is not a directory.",
            path.display()
        )));
    }
    set_mode(path, 0o700)
}

fn executable_file(path: &Path) -> bool {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        let Ok(path) = CString::new(path.as_os_str().as_bytes()) else {
            return false;
        };
        // SAFETY: `path` is a NUL-terminated copy and access performs no mutation.
        let executable = unsafe { libc::access(path.as_ptr(), libc::X_OK) == 0 };
        metadata.file_type().is_file()
            && metadata.len() > 0
            && metadata.permissions().mode() & 0o111 != 0
            && executable
    })
}

fn set_mode(path: &Path, mode: u32) -> Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|error| {
        InstallerError::with_source(format!("Could not secure {}.", path.display()), error)
    })
}

fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| {
            InstallerError::with_source(format!("Could not sync {}.", path.display()), error)
        })
}

fn remove_any(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(InstallerError::with_source(
                "Could not inspect an incomplete Happy Agent install.",
                error,
            ));
        }
    }
    .map_err(|error| {
        InstallerError::with_source("Could not remove an incomplete Happy Agent install.", error)
    })
}

fn unique_path(directory: &Path, prefix: &str) -> Result<PathBuf> {
    for _ in 0..16 {
        let candidate = directory.join(format!("{prefix}{}", random_token()?));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(InstallerError::new(
        "Could not allocate a unique Happy Agent staging path.",
    ))
}

fn random_token() -> Result<String> {
    let mut bytes = [0u8; 16];
    File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|error| {
            InstallerError::with_source(
                "Could not create a secure Happy Agent install token.",
                error,
            )
        })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        os::unix::fs::symlink,
        sync::{
            Arc,
            atomic::{AtomicU64, Ordering},
            mpsc,
        },
    };

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new(label: &str) -> Self {
            let path = env::temp_dir().join(format!(
                "happy-gpui-{label}-{}-{}",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn release(version: &str, url: &str, digest: Option<String>, size: u64) -> Release {
        Release {
            assets: vec![ReleaseAsset {
                browser_download_url: url.into(),
                digest,
                name: format!("happy-agent-{version}-darwin-arm64.tar.gz"),
                size,
            }],
            draft: false,
            prerelease: false,
            tag_name: format!("v{version}"),
        }
    }

    fn digest() -> String {
        format!("sha256:{}", "a".repeat(64))
    }

    #[test]
    fn release_validation_requires_semver_https_exact_asset_and_sha256() {
        let resolved = validate_and_resolve_release(
            release(
                "0.4.27",
                "https://example.test/agent.tar.gz",
                Some(digest()),
                42,
            ),
            TargetArchitecture::Arm64,
        )
        .unwrap();
        assert_eq!(resolved.version, "0.4.27");
        assert_eq!(resolved.archived_binary_name, "happy-agent-darwin-arm64");

        for invalid in [
            release("0.4", "https://example.test/a", Some(digest()), 42),
            release("0.4.27", "http://example.test/a", Some(digest()), 42),
            release("0.4.27", "https://example.test/a", None, 42),
            release(
                "0.4.27",
                "https://example.test/a",
                Some("sha256:no".into()),
                42,
            ),
            release("0.4.27", "https://example.test/a", Some(digest()), 0),
        ] {
            assert!(validate_and_resolve_release(invalid, TargetArchitecture::Arm64).is_err());
        }
    }

    #[test]
    fn executable_validation_rejects_non_executable_and_symlinked_files() {
        let temporary = TempDirectory::new("executable");
        let binary = temporary.0.join("happy-agent");
        fs::write(&binary, b"binary").unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(!executable_file(&binary));
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(executable_file(&binary));

        let linked = temporary.0.join("linked-agent");
        symlink(&binary, &linked).unwrap();
        assert!(!executable_file(&linked));
        assert!(!executable_file(&temporary.0));
    }

    #[test]
    fn install_lock_reclaims_dead_owner_uses_private_mode_and_cleans_up() {
        let temporary = TempDirectory::new("lock");
        let path = temporary.0.join("install.lock");
        fs::write(
            &path,
            serde_json::to_vec(&InstallLockRecord {
                pid: i32::MAX as u32,
                token: "stale".into(),
            })
            .unwrap(),
        )
        .unwrap();
        let mut progress = Vec::new();
        let lock = InstallLock::acquire(&path, &mut |event| progress.push(event)).unwrap();
        assert!(path.is_file());
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(matches!(progress.first(), Some(InstallProgress::Status(_))));
        drop(lock);
        assert!(!path.exists());
    }

    #[test]
    fn install_guard_serializes_stale_reclamation_and_lock_creation() {
        let temporary = Arc::new(TempDirectory::new("guard"));
        let path = temporary.0.join("install.lock");
        let first = InstallLockGuard::try_acquire(&path).unwrap().unwrap();
        let (sender, receiver) = mpsc::channel();
        let thread_path = path.clone();
        let worker = thread::spawn(move || {
            loop {
                if let Some(second) = InstallLockGuard::try_acquire(&thread_path).unwrap() {
                    sender.send(()).unwrap();
                    drop(second);
                    break;
                }
                thread::yield_now();
            }
        });
        assert!(receiver.recv_timeout(Duration::from_millis(100)).is_err());
        drop(first);
        receiver.recv_timeout(Duration::from_secs(2)).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn supplied_resolved_environment_skips_another_shell_capture() {
        let resolved = HashMap::from([
            (OsString::from("PATH"), OsString::from("/resolved/bin")),
            (OsString::from("HOME"), OsString::from("/resolved/home")),
        ]);
        let options = InstallOptions {
            architecture: TargetArchitecture::Arm64,
            base_environment: HashMap::new(),
            shell: PathBuf::from("relative-invalid-shell"),
            daemon_command: DaemonCommand::None,
            command_timeout: Duration::ZERO,
            resolved_environment: Some(resolved.clone()),
        };
        assert_eq!(install_environment(&options).unwrap(), resolved);
    }

    #[test]
    fn happy_home_resolution_matches_the_electron_host_contract() {
        let home = Path::new("/Users/example");
        assert_eq!(happy_home_resolve(None, home), home.join(".happy"));
        assert_eq!(happy_home_resolve(Some("  "), home), home.join(".happy"));
        assert_eq!(happy_home_resolve(Some("~"), home), home);
        assert_eq!(
            happy_home_resolve(Some("~/custom"), home),
            home.join("custom")
        );
        assert_eq!(
            happy_home_resolve(Some("~custom"), home),
            home.join("custom")
        );
        assert_eq!(
            happy_home_resolve(Some("relative"), home),
            home.join("relative")
        );
        assert_eq!(
            happy_home_resolve(Some("/var/happy"), home),
            PathBuf::from("/var/happy")
        );
    }

    #[test]
    fn daemon_paths_trim_and_expand_happy_home_without_touching_route_overrides() {
        let home = Path::new("/Users/example");
        let environment = HashMap::from([
            (
                OsString::from("HAPPY_HOME_DIR"),
                OsString::from(" ~/custom "),
            ),
            (
                OsString::from("HAPPY_AGENT_SERVER_SOCKET_PATH"),
                OsString::from("/managed/server.sock"),
            ),
        ]);
        let paths = HappyDaemonPaths::resolve(&environment, home);
        assert_eq!(paths.happy_home, home.join("custom"));
        assert_eq!(paths.socket_path, home.join("custom/agent/server.sock"));
    }
}
