//! Private, bounded staging for native file previews.
//!
//! Staged names contain only a SHA-256 digest and an allowlisted extension. No
//! workspace path, authorization value, or remote resource is written here.

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use ammonia::{Builder, UrlRelative};
use sha2::{Digest, Sha256};

use super::{
    presentation::{FilePresentation, FilePresentationKind},
    protocol::MAX_FILE_BYTES,
};
use crate::ui::native_preview::{
    NativePreviewKind, PreviewStageRoot, SanitizedHtmlSource, StagedLocalFile,
};

pub const MAX_STAGED_ENTRIES: usize = 32;
pub const MAX_STAGED_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_HTML_INPUT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_SANITIZED_HTML_BYTES: usize = 8 * 1024 * 1024;

const CSP: &str = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; font-src 'none'; style-src 'none'";

#[derive(Debug)]
pub enum PreviewStageError {
    ApplicationSupportUnavailable,
    Io(io::Error),
    UnsafeCacheRoot,
    UnsafeStagedFile,
    FileTooLarge,
    HtmlTooLarge,
    InvalidUtf8,
    PresentationMismatch,
    UnsupportedFormat,
    CapacityPinned,
}

impl std::fmt::Display for PreviewStageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::ApplicationSupportUnavailable => "Application Support is unavailable.",
            Self::Io(_) => "The preview cache could not be accessed.",
            Self::UnsafeCacheRoot => "The preview cache root is not a private directory.",
            Self::UnsafeStagedFile => "The staged preview failed containment validation.",
            Self::FileTooLarge => "Files larger than 44 MiB are unavailable for preview.",
            Self::HtmlTooLarge => "The HTML document is too large for safe preview.",
            Self::InvalidUtf8 => "The HTML document is not valid UTF-8.",
            Self::PresentationMismatch => "The bytes do not match the explicit presentation kind.",
            Self::UnsupportedFormat => "This file format cannot be staged for native preview.",
            Self::CapacityPinned => "Visible previews are using all available preview cache space.",
        })
    }
}
impl std::error::Error for PreviewStageError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}
impl From<io::Error> for PreviewStageError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum StagedRawKind {
    Pdf,
    Audio,
    Video,
    NativeImage,
}

impl StagedRawKind {
    pub fn native_preview_kind(self) -> NativePreviewKind {
        match self {
            Self::Pdf => NativePreviewKind::Pdf,
            Self::Audio => NativePreviewKind::Audio,
            Self::Video => NativePreviewKind::Video,
            Self::NativeImage => NativePreviewKind::Image,
        }
    }
}

#[derive(Debug)]
struct StagedEntry {
    name: Arc<str>,
    path: PathBuf,
    size: u64,
    last_used: AtomicU64,
    _session: Arc<PreviewSession>,
}
impl Drop for StagedEntry {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct PreviewStageKey {
    name: Arc<str>,
    kind: PreviewStageKeyKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum PreviewStageKeyKind {
    Raw(StagedRawKind),
    SanitizedHtml,
}

impl std::fmt::Debug for PreviewStageKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Keep the content digest opaque too. Product code only needs identity/equality.
        f.debug_struct("PreviewStageKey")
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug)]
pub enum ReopenedPreview {
    Raw(StagedRawPreview),
    SanitizedHtml(SanitizedHtmlPreview),
}

/// A clone is a pin. Eviction cannot remove the file until every clone is dropped.
#[derive(Clone, Debug)]
pub struct StagedRawPreview {
    entry: Arc<StagedEntry>,
    root: PreviewStageRoot,
    kind: StagedRawKind,
}
impl StagedRawPreview {
    pub fn kind(&self) -> StagedRawKind {
        self.kind
    }
    pub fn key(&self) -> PreviewStageKey {
        PreviewStageKey {
            name: self.entry.name.clone(),
            kind: PreviewStageKeyKind::Raw(self.kind),
        }
    }
    pub fn staged_file(&self) -> Result<StagedLocalFile, PreviewStageError> {
        StagedLocalFile::try_new(&self.root, self.entry.path.clone())
            .map_err(|_| PreviewStageError::UnsafeStagedFile)
    }
    pub fn byte_len(&self) -> u64 {
        self.entry.size
    }
}

/// HTML can enter NativePreviewKind::Html only through this sanitized type.
#[derive(Clone, Debug)]
pub struct SanitizedHtmlPreview {
    entry: Arc<StagedEntry>,
    root: PreviewStageRoot,
}
impl SanitizedHtmlPreview {
    pub fn key(&self) -> PreviewStageKey {
        PreviewStageKey {
            name: self.entry.name.clone(),
            kind: PreviewStageKeyKind::SanitizedHtml,
        }
    }
    pub fn staged_file(&self) -> Result<StagedLocalFile, PreviewStageError> {
        StagedLocalFile::try_new(&self.root, self.entry.path.clone())
            .map_err(|_| PreviewStageError::UnsafeStagedFile)
    }
    pub fn native_preview_kind(&self) -> NativePreviewKind {
        NativePreviewKind::Html
    }
    pub fn sanitized_source(&self) -> Result<SanitizedHtmlSource, PreviewStageError> {
        Ok(SanitizedHtmlSource::new(self.staged_file()?))
    }
    pub fn byte_len(&self) -> u64 {
        self.entry.size
    }
}

/// Owns one private session below the shared
/// `Application Support/Happy GPUI/preview-cache` directory.
pub struct PreviewStager {
    root: PreviewStageRoot,
    session: Arc<PreviewSession>,
    entries: HashMap<String, Arc<StagedEntry>>,
    total_bytes: u64,
    clock: u64,
}

#[derive(Debug)]
struct PreviewSession {
    base_root: PathBuf,
    root: PathBuf,
    lock_path: PathBuf,
    // The open descriptor holds LOCK_EX until the stager and all preview pins are gone.
    _lock: File,
}

impl Drop for PreviewSession {
    fn drop(&mut self) {
        // StagedEntry drops first when the final preview pin goes away. Only direct,
        // fully validated children are then unlinked; no recursive walk follows links.
        if validate_session_directory(&self.base_root, &self.root).is_ok()
            && validate_session_contents(&self.root).is_ok()
        {
            let _ = remove_session_contents(&self.root);
            let _ = fs::remove_dir(&self.root);
        }
        let _ = fs::remove_file(&self.lock_path);
    }
}

impl PreviewStager {
    pub fn new() -> Result<Self, PreviewStageError> {
        let application_support =
            dirs::data_dir().ok_or(PreviewStageError::ApplicationSupportUnavailable)?;
        Self::at_application_support(application_support)
    }

    /// The argument is the platform Application Support directory, not a workspace root.
    pub fn at_application_support(
        application_support: impl AsRef<Path>,
    ) -> Result<Self, PreviewStageError> {
        let application_support = fs::canonicalize(application_support.as_ref())?;
        let product_root = application_support.join("Happy GPUI");
        ensure_owned_directory(&product_root, 0o700)?;
        let root = product_root.join("preview-cache");
        ensure_private_root(&root)?;
        let canonical = fs::canonicalize(&root)?;
        // Reject a symlink in any product-owned component instead of merely trusting
        // the resolved destination.
        if canonical != root || !canonical.starts_with(&application_support) || !canonical.is_dir()
        {
            return Err(PreviewStageError::UnsafeCacheRoot);
        }
        let session = create_session(&canonical)?;
        // Cleanup is opportunistic. A second process must never be prevented from
        // staging merely because another process is scanning old sessions.
        if let Some(_cleanup_lock) = try_acquire_cleanup_lock(&canonical)? {
            // Cleanup is best effort. A malformed or foreign stale session must
            // not prevent this process from using its new private session.
            let _ = clear_stale_sessions(&canonical, &session.root);
        }
        let root = PreviewStageRoot::try_new(session.root.clone())
            .map_err(|_| PreviewStageError::UnsafeCacheRoot)?;
        Ok(Self {
            root,
            session: Arc::new(session),
            entries: HashMap::new(),
            total_bytes: 0,
            clock: 0,
        })
    }

    pub fn root(&self) -> &Path {
        self.root.as_path()
    }

    /// Re-pins an entry that is still present in this stager's LRU. A miss means the
    /// caller must reread authoritative bytes and stage them again.
    pub fn reopen(&mut self, key: &PreviewStageKey) -> Option<ReopenedPreview> {
        let entry = self.entries.get(key.name.as_ref())?.clone();
        self.clock = self.clock.saturating_add(1);
        entry.last_used.store(self.clock, Ordering::Relaxed);
        Some(match key.kind {
            PreviewStageKeyKind::Raw(kind) => ReopenedPreview::Raw(StagedRawPreview {
                entry,
                root: self.root.clone(),
                kind,
            }),
            PreviewStageKeyKind::SanitizedHtml => {
                ReopenedPreview::SanitizedHtml(SanitizedHtmlPreview {
                    entry,
                    root: self.root.clone(),
                })
            }
        })
    }

    /// Sanitizes a single-file HTML document. Relative dependencies cannot load because all
    /// resource URL attributes are removed and CSP denies every resource class.
    pub fn stage_html(
        &mut self,
        presentation: &FilePresentation,
        bytes: &[u8],
    ) -> Result<SanitizedHtmlPreview, PreviewStageError> {
        if presentation.kind != FilePresentationKind::Html {
            return Err(PreviewStageError::PresentationMismatch);
        }
        if bytes.len() > MAX_FILE_BYTES {
            return Err(PreviewStageError::FileTooLarge);
        }
        if bytes.len() > MAX_HTML_INPUT_BYTES {
            return Err(PreviewStageError::HtmlTooLarge);
        }
        let html = std::str::from_utf8(bytes).map_err(|_| PreviewStageError::InvalidUtf8)?;
        let sanitized = sanitize_html(html);
        if sanitized.len() > MAX_SANITIZED_HTML_BYTES {
            return Err(PreviewStageError::HtmlTooLarge);
        }
        let entry = self.stage_bytes("html", sanitized.as_bytes())?;
        Ok(SanitizedHtmlPreview {
            entry,
            root: self.root.clone(),
        })
    }

    /// Stages only raw kinds whose presentation was already fixed at the byte boundary.
    pub fn stage_raw(
        &mut self,
        presentation: &FilePresentation,
        bytes: &[u8],
    ) -> Result<StagedRawPreview, PreviewStageError> {
        if bytes.len() > MAX_FILE_BYTES {
            return Err(PreviewStageError::FileTooLarge);
        }
        let extension = presentation.extension.as_deref().unwrap_or("");
        let (kind, safe_extension) = match presentation.kind {
            FilePresentationKind::Pdf if extension == "pdf" => (StagedRawKind::Pdf, "pdf"),
            FilePresentationKind::Audio => {
                (StagedRawKind::Audio, allow_audio_extension(extension)?)
            }
            FilePresentationKind::Video => {
                (StagedRawKind::Video, allow_video_extension(extension)?)
            }
            FilePresentationKind::NativeImage => (
                StagedRawKind::NativeImage,
                allow_native_image_extension(extension)?,
            ),
            _ => return Err(PreviewStageError::PresentationMismatch),
        };
        let entry = self.stage_bytes(safe_extension, bytes)?;
        Ok(StagedRawPreview {
            entry,
            root: self.root.clone(),
            kind,
        })
    }

    fn stage_bytes(
        &mut self,
        extension: &'static str,
        bytes: &[u8],
    ) -> Result<Arc<StagedEntry>, PreviewStageError> {
        let mut hasher = Sha256::new();
        hasher.update(extension.as_bytes());
        hasher.update([0]);
        hasher.update(bytes);
        let name = format!("{:x}.{extension}", hasher.finalize());
        self.clock = self.clock.saturating_add(1);
        if let Some(entry) = self.entries.get(&name) {
            entry.last_used.store(self.clock, Ordering::Relaxed);
            return Ok(entry.clone());
        }
        self.make_room(bytes.len() as u64)?;
        let destination = self.root.as_path().join(&name);
        validate_direct_child(self.root.as_path(), &destination)?;
        if fs::symlink_metadata(&destination).is_ok() {
            fs::remove_file(&destination)?;
        }
        let temporary = self.root.as_path().join(format!(
            ".stage-{}-{}-{name}",
            std::process::id(),
            self.clock
        ));
        validate_direct_child(self.root.as_path(), &temporary)?;
        let write_result = write_atomic(&temporary, &destination, bytes);
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write_result?;
        let canonical = fs::canonicalize(&destination)?;
        if canonical.parent() != Some(self.root.as_path())
            || !canonical.starts_with(self.root.as_path())
        {
            let _ = fs::remove_file(&destination);
            return Err(PreviewStageError::UnsafeStagedFile);
        }
        set_file_mode(&canonical, 0o600)?;
        // Exercise the UI boundary now, rather than after the caller makes a native view.
        StagedLocalFile::try_new(&self.root, canonical.clone())
            .map_err(|_| PreviewStageError::UnsafeStagedFile)?;
        let entry = Arc::new(StagedEntry {
            name: Arc::from(name.as_str()),
            path: canonical,
            size: bytes.len() as u64,
            last_used: AtomicU64::new(self.clock),
            _session: self.session.clone(),
        });
        self.total_bytes = self.total_bytes.saturating_add(entry.size);
        self.entries.insert(name, entry.clone());
        Ok(entry)
    }

    fn make_room(&mut self, incoming: u64) -> Result<(), PreviewStageError> {
        if incoming > MAX_STAGED_BYTES {
            return Err(PreviewStageError::FileTooLarge);
        }
        while self.entries.len() >= MAX_STAGED_ENTRIES
            || self.total_bytes.saturating_add(incoming) > MAX_STAGED_BYTES
        {
            let victim = self
                .entries
                .iter()
                .filter(|(_, entry)| Arc::strong_count(entry) == 1)
                .min_by_key(|(_, entry)| entry.last_used.load(Ordering::Relaxed))
                .map(|(name, _)| name.clone());
            let Some(victim) = victim else {
                return Err(PreviewStageError::CapacityPinned);
            };
            if let Some(entry) = self.entries.remove(&victim) {
                self.total_bytes = self.total_bytes.saturating_sub(entry.size);
            }
        }
        Ok(())
    }
}

fn sanitize_html(input: &str) -> String {
    // Exact allowlist: no form, iframe, embed, object, meta, base, style, media, SVG,
    // or URL-bearing attributes. Basic document structure and classes survive.
    let tags: HashSet<&str> = [
        "a",
        "abbr",
        "b",
        "blockquote",
        "br",
        "caption",
        "code",
        "col",
        "colgroup",
        "dd",
        "del",
        "details",
        "div",
        "dl",
        "dt",
        "em",
        "figcaption",
        "figure",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hr",
        "i",
        "kbd",
        "li",
        "main",
        "mark",
        "ol",
        "p",
        "pre",
        "q",
        "s",
        "section",
        "small",
        "span",
        "strong",
        "sub",
        "summary",
        "sup",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "tr",
        "u",
        "ul",
    ]
    .into_iter()
    .collect();
    let attributes: HashSet<&str> = ["class", "title", "aria-label", "colspan", "rowspan"]
        .into_iter()
        .collect();
    let clean_content: HashSet<&str> = [
        "script", "style", "iframe", "embed", "object", "form", "meta", "base", "template",
        "audio", "video", "source", "track", "img", "svg", "math",
    ]
    .into_iter()
    .collect();
    let clean = Builder::default()
        .tags(tags)
        .generic_attributes(attributes)
        .tag_attributes(HashMap::new())
        .clean_content_tags(clean_content)
        .url_schemes(HashSet::new())
        .url_relative(UrlRelative::Deny)
        .link_rel(None)
        .clean(input)
        .to_string();
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"{CSP}\"></head><body>{clean}</body></html>"
    )
}

fn allow_audio_extension(extension: &str) -> Result<&'static str, PreviewStageError> {
    match extension {
        "mp3" => Ok("mp3"),
        "m4a" => Ok("m4a"),
        "aac" => Ok("aac"),
        "wav" => Ok("wav"),
        "aiff" => Ok("aiff"),
        "flac" => Ok("flac"),
        "ogg" => Ok("ogg"),
        "oga" => Ok("oga"),
        _ => Err(PreviewStageError::UnsupportedFormat),
    }
}
fn allow_video_extension(extension: &str) -> Result<&'static str, PreviewStageError> {
    match extension {
        "mp4" => Ok("mp4"),
        "m4v" => Ok("m4v"),
        "mov" => Ok("mov"),
        "webm" => Ok("webm"),
        "avi" => Ok("avi"),
        "mkv" => Ok("mkv"),
        "ogv" => Ok("ogv"),
        "mpg" => Ok("mpg"),
        "mpeg" => Ok("mpeg"),
        _ => Err(PreviewStageError::UnsupportedFormat),
    }
}
fn allow_native_image_extension(extension: &str) -> Result<&'static str, PreviewStageError> {
    match extension {
        "heic" => Ok("heic"),
        "heif" => Ok("heif"),
        "tif" => Ok("tif"),
        "tiff" => Ok("tiff"),
        _ => Err(PreviewStageError::UnsupportedFormat),
    }
}

fn create_session(base_root: &Path) -> Result<PreviewSession, PreviewStageError> {
    for _ in 0..16 {
        let id = cuid2::create_id();
        let root = base_root.join(format!("session-{id}"));
        let lock_path = base_root.join(format!(".session-{id}.lock"));
        validate_cache_child(base_root, &root)?;
        validate_cache_child(base_root, &lock_path)?;

        let lock = match open_lock_file(&lock_path, true) {
            Ok(file) => file,
            Err(PreviewStageError::Io(error)) if error.kind() == io::ErrorKind::AlreadyExists => {
                continue;
            }
            Err(error) => return Err(error),
        };
        if !try_lock_exclusive(&lock)? {
            let _ = fs::remove_file(&lock_path);
            continue;
        }

        match fs::create_dir(&root) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let _ = fs::remove_file(&lock_path);
                continue;
            }
            Err(error) => {
                let _ = fs::remove_file(&lock_path);
                return Err(error.into());
            }
        }
        if let Err(error) =
            ensure_private_root(&root).and_then(|()| validate_session_directory(base_root, &root))
        {
            let _ = fs::remove_dir(&root);
            let _ = fs::remove_file(&lock_path);
            return Err(error);
        }
        return Ok(PreviewSession {
            base_root: base_root.to_path_buf(),
            root,
            lock_path,
            _lock: lock,
        });
    }
    Err(PreviewStageError::Io(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique preview session",
    )))
}

fn try_acquire_cleanup_lock(root: &Path) -> Result<Option<File>, PreviewStageError> {
    let path = root.join(".cleanup.lock");
    validate_cache_child(root, &path)?;
    let file = open_lock_file(&path, false)?;
    if try_lock_exclusive(&file)? {
        Ok(Some(file))
    } else {
        Ok(None)
    }
}

fn open_lock_file(path: &Path, create_new: bool) -> Result<File, PreviewStageError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(PreviewStageError::UnsafeCacheRoot);
        }
        Ok(_) if create_new => {
            return Err(PreviewStageError::Io(io::Error::from(
                io::ErrorKind::AlreadyExists,
            )));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    if create_new {
        options.create_new(true);
    } else {
        options.create(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;
    set_file_mode(path, 0o600)?;
    validate_private_file(path, &file)?;
    Ok(file)
}

fn validate_private_file(path: &Path, file: &File) -> Result<(), PreviewStageError> {
    let path_metadata = fs::symlink_metadata(path)?;
    if path_metadata.file_type().is_symlink() || !path_metadata.is_file() {
        return Err(PreviewStageError::UnsafeCacheRoot);
    }
    let canonical = fs::canonicalize(path)?;
    if canonical != path {
        return Err(PreviewStageError::UnsafeCacheRoot);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata()?;
        if metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o777 != 0o600
            || metadata.dev() != path_metadata.dev()
            || metadata.ino() != path_metadata.ino()
        {
            return Err(PreviewStageError::UnsafeCacheRoot);
        }
    }
    Ok(())
}

#[cfg(unix)]
fn try_lock_exclusive(file: &File) -> Result<bool, PreviewStageError> {
    use std::os::fd::AsRawFd;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if matches!(error.raw_os_error(), Some(code) if code == libc::EWOULDBLOCK || code == libc::EAGAIN)
    {
        Ok(false)
    } else {
        Err(error.into())
    }
}

#[cfg(not(unix))]
fn try_lock_exclusive(_file: &File) -> Result<bool, PreviewStageError> {
    Ok(true)
}

fn clear_stale_sessions(base_root: &Path, current_root: &Path) -> Result<(), PreviewStageError> {
    let mut orphan_locks = Vec::new();
    let mut legacy_files = Vec::new();
    let legacy_lock_path = base_root.join(".preview-cache.lock");
    let mut legacy_lock_present = false;
    for item in fs::read_dir(base_root)? {
        let item = item?;
        let name = item.file_name();
        let Some(name) = name.to_str() else {
            return Err(PreviewStageError::UnsafeCacheRoot);
        };
        if name == ".cleanup.lock" {
            continue;
        }
        if name == ".preview-cache.lock" {
            legacy_lock_present = true;
            continue;
        }
        if name.starts_with(".session-") && name.ends_with(".lock") {
            orphan_locks.push(item.path());
            continue;
        }
        if !name.starts_with("session-") {
            let path = item.path();
            validate_legacy_cache_file(base_root, &path)?;
            legacy_files.push(path);
            continue;
        }
        let session_root = item.path();
        if session_root == current_root {
            continue;
        }
        validate_session_directory(base_root, &session_root)?;
        let id = name.strip_prefix("session-").expect("prefix checked");
        let lock_path = base_root.join(format!(".session-{id}.lock"));
        validate_cache_child(base_root, &lock_path)?;
        let lock = open_lock_file(&lock_path, false)?;
        if !try_lock_exclusive(&lock)? {
            continue;
        }
        validate_session_directory(base_root, &session_root)?;
        validate_session_contents(&session_root)?;
        remove_session_contents(&session_root)?;
        fs::remove_dir(&session_root)?;
        fs::remove_file(&lock_path)?;
    }

    if legacy_lock_present || !legacy_files.is_empty() {
        validate_cache_child(base_root, &legacy_lock_path)?;
        let legacy_lock = open_lock_file(&legacy_lock_path, false)?;
        if try_lock_exclusive(&legacy_lock)? {
            // The previous single-root implementation used this lock for its full
            // lifetime. Only after it is idle may its validated direct files go away.
            for path in legacy_files {
                validate_legacy_cache_file(base_root, &path)?;
                fs::remove_file(path)?;
            }
            fs::remove_file(&legacy_lock_path)?;
        }
    }

    for lock_path in orphan_locks {
        let name = lock_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(PreviewStageError::UnsafeCacheRoot)?;
        let id = name
            .strip_prefix(".session-")
            .and_then(|name| name.strip_suffix(".lock"))
            .ok_or(PreviewStageError::UnsafeCacheRoot)?;
        if base_root.join(format!("session-{id}")).exists() {
            continue;
        }
        validate_cache_child(base_root, &lock_path)?;
        let lock = open_lock_file(&lock_path, false)?;
        if try_lock_exclusive(&lock)? {
            fs::remove_file(lock_path)?;
        }
    }
    Ok(())
}

fn validate_legacy_cache_file(base_root: &Path, path: &Path) -> Result<(), PreviewStageError> {
    validate_cache_child(base_root, path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(PreviewStageError::UnsafeCacheRoot);
    }
    let canonical = fs::canonicalize(path)?;
    if canonical != path || canonical.parent() != Some(base_root) {
        return Err(PreviewStageError::UnsafeCacheRoot);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o777 != 0o600 {
            return Err(PreviewStageError::UnsafeCacheRoot);
        }
    }
    Ok(())
}

fn validate_session_directory(
    base_root: &Path,
    session_root: &Path,
) -> Result<(), PreviewStageError> {
    validate_cache_child(base_root, session_root)?;
    let metadata = fs::symlink_metadata(session_root)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(PreviewStageError::UnsafeCacheRoot);
    }
    let canonical = fs::canonicalize(session_root)?;
    if canonical != session_root || canonical.parent() != Some(base_root) {
        return Err(PreviewStageError::UnsafeCacheRoot);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o777 != 0o700 {
            return Err(PreviewStageError::UnsafeCacheRoot);
        }
    }
    Ok(())
}

fn validate_session_contents(session_root: &Path) -> Result<(), PreviewStageError> {
    for item in fs::read_dir(session_root)? {
        let item = item?;
        let path = item.path();
        validate_cache_child(session_root, &path)?;
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(PreviewStageError::UnsafeCacheRoot);
        }
        let canonical = fs::canonicalize(&path)?;
        if canonical != path || canonical.parent() != Some(session_root) {
            return Err(PreviewStageError::UnsafeCacheRoot);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o777 != 0o600 {
                return Err(PreviewStageError::UnsafeCacheRoot);
            }
        }
    }
    Ok(())
}

fn remove_session_contents(session_root: &Path) -> io::Result<()> {
    for item in fs::read_dir(session_root)? {
        let item = item?;
        let path = item.path();
        if path.parent() != Some(session_root) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "preview cache child escaped its session",
            ));
        }
        // remove_file unlinks a symlink itself and never follows it. Validation is
        // still required before reaching this helper.
        fs::remove_file(path)?;
    }
    Ok(())
}

fn validate_cache_child(root: &Path, path: &Path) -> Result<(), PreviewStageError> {
    if path.parent() != Some(root) || !path.starts_with(root) {
        Err(PreviewStageError::UnsafeCacheRoot)
    } else {
        Ok(())
    }
}

fn ensure_owned_directory(path: &Path, mode: u32) -> Result<(), PreviewStageError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(PreviewStageError::UnsafeCacheRoot);
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir(path)?,
        Err(error) => return Err(error.into()),
    }
    set_file_mode(path, mode)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(PreviewStageError::UnsafeCacheRoot);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o777 != mode {
            return Err(PreviewStageError::UnsafeCacheRoot);
        }
    }
    Ok(())
}

fn ensure_private_root(root: &Path) -> Result<(), PreviewStageError> {
    ensure_owned_directory(root, 0o700)
}

fn validate_direct_child(root: &Path, path: &Path) -> Result<(), PreviewStageError> {
    if path.parent() != Some(root) || !path.starts_with(root) {
        Err(PreviewStageError::UnsafeStagedFile)
    } else {
        Ok(())
    }
}

fn write_atomic(temporary: &Path, destination: &Path, bytes: &[u8]) -> io::Result<()> {
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file: File = options.open(temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    set_file_mode(temporary, 0o600)?;
    fs::rename(temporary, destination)?;
    Ok(())
}

#[cfg(unix)]
fn set_file_mode(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}
#[cfg(not(unix))]
fn set_file_mode(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::presentation::{FileFamily, ImageProbe};

    struct TestApplicationSupport(PathBuf);

    impl TestApplicationSupport {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "happy-preview-staging-test-{}-{}",
                std::process::id(),
                cuid2::create_id()
            ));
            fs::create_dir(&path).expect("create test Application Support");
            Self(fs::canonicalize(path).expect("canonicalize test Application Support"))
        }
    }

    impl Drop for TestApplicationSupport {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn pdf_presentation() -> FilePresentation {
        FilePresentation {
            family: FileFamily::Other,
            kind: FilePresentationKind::Pdf,
            extension: Some(Arc::from("pdf")),
            syntax_hint: None,
            image: ImageProbe::NotImage,
        }
    }

    #[test]
    fn simultaneous_stagers_use_distinct_sessions_and_preserve_active_cache() {
        let support = TestApplicationSupport::new();
        let mut first = PreviewStager::at_application_support(&support.0).expect("first stager");
        let mut second = PreviewStager::at_application_support(&support.0).expect("second stager");
        assert_ne!(first.root(), second.root());

        let first_preview = first
            .stage_raw(&pdf_presentation(), b"%PDF-first")
            .expect("stage first preview");
        let second_preview = second
            .stage_raw(&pdf_presentation(), b"%PDF-second")
            .expect("stage second preview");
        let first_root = first.root().to_path_buf();
        let second_root = second.root().to_path_buf();
        let second_file = second_preview
            .staged_file()
            .expect("second staged file")
            .as_path()
            .to_path_buf();

        drop(first);
        assert!(first_root.exists(), "a preview pin keeps its session alive");
        assert!(
            second_root.exists(),
            "another active cache must not be deleted"
        );
        assert!(
            second_file.exists(),
            "another active staged file must survive"
        );

        drop(first_preview);
        assert!(
            !first_root.exists(),
            "the unpinned session is removed on drop"
        );
        assert!(
            second_root.exists(),
            "dropping one stager must not remove another"
        );
        assert!(second_file.exists(), "the active process remains usable");

        drop(second);
        assert!(
            second_root.exists(),
            "the second preview still pins its session"
        );
        drop(second_preview);
        assert!(
            !second_root.exists(),
            "the final pin releases the second session"
        );
    }

    #[test]
    fn later_startup_removes_a_fully_validated_crash_leftover() {
        let support = TestApplicationSupport::new();
        let product_root = support.0.join("Happy GPUI");
        ensure_owned_directory(&product_root, 0o700).expect("product root");
        let base_root = product_root.join("preview-cache");
        ensure_private_root(&base_root).expect("base root");

        let stale_root = base_root.join("session-crash-leftover");
        fs::create_dir(&stale_root).expect("stale session root");
        set_file_mode(&stale_root, 0o700).expect("private stale session root");
        let stale_file = stale_root.join("staged.pdf");
        fs::write(&stale_file, b"%PDF-crash").expect("stale staged file");
        set_file_mode(&stale_file, 0o600).expect("private stale staged file");
        let stale_lock = base_root.join(".session-crash-leftover.lock");
        let lock = open_lock_file(&stale_lock, true).expect("stale session marker");
        assert!(try_lock_exclusive(&lock).expect("lock stale session"));
        drop(lock);

        let stager = PreviewStager::at_application_support(&support.0).expect("later stager");
        assert!(
            !stale_root.exists(),
            "the stale validated session is removed"
        );
        assert!(!stale_lock.exists(), "its stale marker is removed");
        assert!(stager.root().exists(), "the new session remains usable");
    }

    #[test]
    fn busy_global_cleanup_lock_does_not_block_a_new_session() {
        let support = TestApplicationSupport::new();
        let product_root = support.0.join("Happy GPUI");
        ensure_owned_directory(&product_root, 0o700).expect("product root");
        let base_root = product_root.join("preview-cache");
        ensure_private_root(&base_root).expect("base root");
        let cleanup_lock =
            open_lock_file(&base_root.join(".cleanup.lock"), false).expect("open cleanup lock");
        assert!(try_lock_exclusive(&cleanup_lock).expect("lock cleanup"));

        let mut stager = PreviewStager::at_application_support(&support.0)
            .expect("a busy cleanup scan must not block staging");
        let preview = stager
            .stage_raw(&pdf_presentation(), b"%PDF-while-cleanup-busy")
            .expect("stage while cleanup is busy");
        assert!(
            preview
                .staged_file()
                .expect("staged file")
                .as_path()
                .exists()
        );
    }
}
