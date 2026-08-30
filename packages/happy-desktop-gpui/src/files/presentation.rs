//! File-boundary presentation classification and bounded text projections.
//!
//! Extension and byte inspection happen here, once. Callers carry the closed
//! presentation result and must not infer MIME types downstream.

use std::{
    collections::{HashMap, VecDeque},
    io::Cursor,
    ops::Range,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

use gpui::SharedString;
use percent_encoding::percent_decode_str;
use similar::{Algorithm, ChangeTag, DiffTag, TextDiff};
use syntect::{
    easy::ScopeRangeIterator,
    parsing::{ParseState, Scope, ScopeStack, SyntaxReference, SyntaxSet},
};
use url::Url;

use super::protocol::{MAX_EDITOR_BYTES, RelativeFilePath};
use crate::ui::{
    file_diff::{FileDiffLine, FileDiffLineKind},
    text_area::{TextHighlightKind, TextHighlightSpan},
};

pub const MAX_PRESENTATION_CHARS: usize = 250_000;
pub const MAX_CACHE_ENTRIES: usize = 12;
pub const MAX_CACHE_CHARS: usize = 1_000_000;
pub const MAX_HIGHLIGHT_SPANS: usize = 100_000;
pub const MAX_DIFF_LINES_PER_SIDE: usize = 20_000;
pub const MAX_DIFF_OUTPUT_LINES: usize = 50_000;
pub const DIFF_CONTEXT_LINES: usize = 3;
pub const MAX_DIFF_COMPUTE_TIME: Duration = Duration::from_millis(75);
pub const MAX_IMAGE_DIMENSION: u32 = 16_384;
pub const MAX_IMAGE_PIXELS: u64 = 32_000_000;
/// Integration contract for a decoded RGBA image cache. Active views must pin entries.
pub const MAX_DECODED_IMAGE_CACHE_ENTRIES: usize = 24;
pub const MAX_DECODED_IMAGE_CACHE_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_GIF_FRAMES: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FileFamily {
    Code,
    Data,
    Style,
    Image,
    Video,
    Audio,
    Shell,
    Secret,
    Archive,
    Prose,
    Config,
    Directory,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FilePresentationKind {
    EditableText,
    ReadOnlyText,
    Markdown,
    Html,
    GpuiImage,
    NativeImage,
    Audio,
    Video,
    Pdf,
    Binary,
    Unsupported,
}

/// The authoritative result of inspecting a validated path and its external bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FilePresentation {
    pub family: FileFamily,
    pub kind: FilePresentationKind,
    /// Lowercase and without a dot. Dotfile pseudo-extensions are explicit too.
    pub extension: Option<Arc<str>>,
    /// A syntect extension/name hint from the same taxonomy, never a MIME guess.
    pub syntax_hint: Option<Arc<str>>,
    /// Explicit probe result produced before GPUI/AppKit is allowed to decode the image.
    pub image: ImageProbe,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}
impl ImageDimensions {
    pub fn estimated_rgba_bytes(self) -> u64 {
        u64::from(self.width)
            .saturating_mul(u64::from(self.height))
            .saturating_mul(4)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageProbe {
    NotImage,
    Safe(ImageDimensions),
    DimensionsUnavailable,
    DecodeUnavailable(ImageDimensions),
    DecodeTooLarge(ImageDimensions),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GifPreflight {
    Safe,
    DecodeUnavailable,
    DecodeTooLarge,
}

/// GPUI retains every decoded GIF frame. Decode the stream once on the presentation worker so
/// malformed input and cumulative frame memory are rejected before GPUI receives the bytes.
fn gif_preflight(bytes: &[u8], dimensions: ImageDimensions) -> GifPreflight {
    let mut decoder = match gif::DecodeOptions::new().read_info(Cursor::new(bytes)) {
        Ok(decoder) => decoder,
        Err(_) => return GifPreflight::DecodeUnavailable,
    };
    if u32::from(decoder.width()) != dimensions.width
        || u32::from(decoder.height()) != dimensions.height
    {
        return GifPreflight::DecodeUnavailable;
    }
    let frame_bytes = dimensions.estimated_rgba_bytes();
    let mut frame_count = 0usize;
    loop {
        match decoder.read_next_frame() {
            Ok(Some(_)) => {
                frame_count = frame_count.saturating_add(1);
                if frame_count > MAX_GIF_FRAMES
                    || frame_bytes.saturating_mul(frame_count as u64)
                        > MAX_DECODED_IMAGE_CACHE_BYTES
                {
                    return GifPreflight::DecodeTooLarge;
                }
            }
            Ok(None) if frame_count > 0 => return GifPreflight::Safe,
            Ok(None) | Err(_) => return GifPreflight::DecodeUnavailable,
        }
    }
}

/// Fully decode GPUI's still-image formats on the presentation worker. The decoded pixels are
/// dropped immediately; this only proves GPUI will receive a complete, internally consistent file.
fn still_image_preflight(
    extension: Option<&str>,
    bytes: &[u8],
    dimensions: ImageDimensions,
) -> bool {
    let format = match extension {
        Some("png") => image::ImageFormat::Png,
        Some("jpg" | "jpeg") => image::ImageFormat::Jpeg,
        Some("webp") => image::ImageFormat::WebP,
        Some("bmp") => image::ImageFormat::Bmp,
        _ => return true,
    };
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_DECODED_IMAGE_CACHE_BYTES);
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    match reader.decode() {
        Ok(decoded) => decoded.width() == dimensions.width && decoded.height() == dimensions.height,
        Err(_) => false,
    }
}

#[derive(Clone, Copy)]
struct ExtensionFacts<'a> {
    family: FileFamily,
    preferred: PreferredKind,
    syntax: Option<&'a str>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PreferredKind {
    Text,
    ReadOnlyText,
    Markdown,
    Html,
    GpuiImage,
    NativeImage,
    Audio,
    Video,
    Pdf,
    Binary,
    Unsupported,
    Unknown,
}

impl FilePresentation {
    pub fn directory() -> Self {
        Self {
            family: FileFamily::Directory,
            kind: FilePresentationKind::Unsupported,
            extension: None,
            syntax_hint: None,
            image: ImageProbe::NotImage,
        }
    }

    /// Classifies bytes received from the file daemon. This is the only content-sniffing boundary.
    /// Callers must run this on a background worker because image safety preflight fully decodes
    /// supported streams.
    pub fn from_external_bytes(path: &RelativeFilePath, bytes: &[u8]) -> Self {
        let extension = normalized_extension(path);
        let facts = extension_facts(extension.as_deref());
        let utf8 = std::str::from_utf8(bytes).is_ok();
        let text_kind = || {
            if bytes.len() <= MAX_EDITOR_BYTES {
                FilePresentationKind::EditableText
            } else {
                FilePresentationKind::ReadOnlyText
            }
        };
        let mut kind = match facts.preferred {
            PreferredKind::Text if utf8 => text_kind(),
            PreferredKind::ReadOnlyText if utf8 => FilePresentationKind::ReadOnlyText,
            PreferredKind::Markdown if utf8 => FilePresentationKind::Markdown,
            PreferredKind::Html if utf8 => FilePresentationKind::Html,
            PreferredKind::GpuiImage => FilePresentationKind::GpuiImage,
            PreferredKind::NativeImage => FilePresentationKind::NativeImage,
            PreferredKind::Audio if valid_audio_signature(extension.as_deref(), bytes) => {
                FilePresentationKind::Audio
            }
            PreferredKind::Video if valid_video_signature(extension.as_deref(), bytes) => {
                FilePresentationKind::Video
            }
            PreferredKind::Pdf if bytes.starts_with(b"%PDF-") => FilePresentationKind::Pdf,
            PreferredKind::Audio | PreferredKind::Video | PreferredKind::Pdf => {
                FilePresentationKind::Binary
            }
            PreferredKind::Binary => FilePresentationKind::Binary,
            PreferredKind::Unsupported => FilePresentationKind::Unsupported,
            PreferredKind::Unknown if utf8 => text_kind(),
            // A known text extension containing invalid UTF-8 is still binary. It is never
            // lossily decoded, and a known binary extension never reaches UTF-8 fallback.
            PreferredKind::Text
            | PreferredKind::ReadOnlyText
            | PreferredKind::Markdown
            | PreferredKind::Html
            | PreferredKind::Unknown => FilePresentationKind::Binary,
        };
        let image = if matches!(
            facts.preferred,
            PreferredKind::GpuiImage | PreferredKind::NativeImage
        ) {
            match imagesize::blob_size(bytes) {
                Ok(size) => {
                    let dimensions = ImageDimensions {
                        width: u32::try_from(size.width).unwrap_or(u32::MAX),
                        height: u32::try_from(size.height).unwrap_or(u32::MAX),
                    };
                    let pixels =
                        u64::from(dimensions.width).saturating_mul(u64::from(dimensions.height));
                    if dimensions.width == 0
                        || dimensions.height == 0
                        || dimensions.width > MAX_IMAGE_DIMENSION
                        || dimensions.height > MAX_IMAGE_DIMENSION
                        || pixels > MAX_IMAGE_PIXELS
                        || dimensions.estimated_rgba_bytes() > MAX_DECODED_IMAGE_CACHE_BYTES
                    {
                        kind = FilePresentationKind::Unsupported;
                        ImageProbe::DecodeTooLarge(dimensions)
                    } else if extension.as_deref() == Some("gif") {
                        match gif_preflight(bytes, dimensions) {
                            GifPreflight::Safe => ImageProbe::Safe(dimensions),
                            GifPreflight::DecodeUnavailable => {
                                kind = FilePresentationKind::Unsupported;
                                ImageProbe::DecodeUnavailable(dimensions)
                            }
                            GifPreflight::DecodeTooLarge => {
                                kind = FilePresentationKind::Unsupported;
                                ImageProbe::DecodeTooLarge(dimensions)
                            }
                        }
                    } else if still_image_preflight(extension.as_deref(), bytes, dimensions) {
                        ImageProbe::Safe(dimensions)
                    } else {
                        kind = FilePresentationKind::Unsupported;
                        ImageProbe::DecodeUnavailable(dimensions)
                    }
                }
                Err(_) => {
                    kind = FilePresentationKind::Unsupported;
                    ImageProbe::DimensionsUnavailable
                }
            }
        } else {
            ImageProbe::NotImage
        };
        let family = facts.family;
        let syntax_hint = facts.syntax.map(Arc::from);
        Self {
            family,
            kind,
            extension: extension.map(Arc::from),
            syntax_hint,
            image,
        }
    }

    pub fn is_text(&self) -> bool {
        matches!(
            self.kind,
            FilePresentationKind::EditableText
                | FilePresentationKind::ReadOnlyText
                | FilePresentationKind::Markdown
                | FilePresentationKind::Html
        )
    }
}

fn valid_audio_signature(extension: Option<&str>, bytes: &[u8]) -> bool {
    match extension {
        Some("mp3") => bytes.starts_with(b"ID3") || mpeg_audio_frame(bytes),
        Some("aac") => adts_audio_frame(bytes),
        Some("wav") => riff_kind(bytes, b"WAVE"),
        Some("aiff") => {
            bytes.len() >= 12
                && bytes.starts_with(b"FORM")
                && matches!(&bytes[8..12], b"AIFF" | b"AIFC")
        }
        Some("flac") => bytes.starts_with(b"fLaC"),
        Some("ogg" | "oga") => bytes.starts_with(b"OggS"),
        Some("m4a") => iso_base_media(bytes),
        _ => false,
    }
}

fn valid_video_signature(extension: Option<&str>, bytes: &[u8]) -> bool {
    match extension {
        Some("mp4" | "m4v" | "mov") => iso_base_media(bytes),
        Some("webm" | "mkv") => bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]),
        Some("ogv") => bytes.starts_with(b"OggS"),
        Some("mpg" | "mpeg") => {
            bytes.starts_with(&[0x00, 0x00, 0x01, 0xba])
                || bytes.starts_with(&[0x00, 0x00, 0x01, 0xb3])
        }
        Some("avi") => riff_kind(bytes, b"AVI "),
        _ => false,
    }
}

fn iso_base_media(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[4..8] == b"ftyp"
}
fn riff_kind(bytes: &[u8], kind: &[u8; 4]) -> bool {
    bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == kind
}
fn mpeg_audio_frame(bytes: &[u8]) -> bool {
    bytes.len() >= 4
        && bytes[0] == 0xff
        && bytes[1] & 0xe0 == 0xe0
        && bytes[1] & 0x18 != 0x08
        && bytes[1] & 0x06 != 0
        && !matches!(bytes[2] >> 4, 0 | 15)
        && (bytes[2] >> 2) & 0x03 != 0x03
}
fn adts_audio_frame(bytes: &[u8]) -> bool {
    bytes.len() >= 7 && bytes[0] == 0xff && bytes[1] & 0xf6 == 0xf0
}

/// Path-only family projection for browser rows. It uses the exact preview taxonomy.
pub fn file_family(path: &RelativeFilePath) -> FileFamily {
    let extension = normalized_extension(path);
    extension_facts(extension.as_deref()).family
}

fn normalized_extension(path: &RelativeFilePath) -> Option<String> {
    let name = path.as_str().rsplit('/').next()?;
    let lower = name.to_ascii_lowercase();
    if lower == ".env" || lower.starts_with(".env.") {
        return Some(".env".to_owned());
    }
    if lower.starts_with('.') && !lower[1..].contains('.') {
        return Some(lower);
    }
    name.rsplit_once('.')
        .filter(|(stem, extension)| !stem.is_empty() && !extension.is_empty())
        .map(|(_, extension)| extension.to_ascii_lowercase())
}

fn extension_facts(extension: Option<&str>) -> ExtensionFacts<'_> {
    use FileFamily::*;
    use PreferredKind::*;
    let Some(ext) = extension else {
        return ExtensionFacts {
            family: Other,
            preferred: Unknown,
            syntax: None,
        };
    };
    let (family, preferred, syntax) = match ext {
        "md" | "markdown" | "mdown" | "mkd" => (Prose, Markdown, Some("md")),
        "html" | "htm" | "xhtml" => (Code, Html, Some("html")),
        "css" | "scss" | "sass" | "less" => (Style, Text, Some(ext)),
        "js" | "jsx" | "mjs" | "cjs" | "ts" | "tsx" | "rs" | "py" | "rb" | "go" | "java" | "kt"
        | "kts" | "swift" | "c" | "h" | "cc" | "cpp" | "cxx" | "hpp" | "cs" | "fs" | "fsx"
        | "php" | "lua" | "r" | "scala" | "clj" | "cljs" | "ex" | "exs" | "erl" | "hrl" | "hs"
        | "lhs" | "ml" | "mli" | "vue" | "svelte" | "zig" | "sol" | "dart" => {
            (Code, Text, Some(ext))
        }
        "sh" | "bash" | "zsh" | "fish" | "command" | ".bashrc" | ".zshrc" => {
            (Shell, Text, Some("sh"))
        }
        "json" | "json5" | "jsonl" | "ndjson" | "csv" | "tsv" | "xml" | "sql" | "graphql"
        | "gql" => (Data, Text, Some(ext)),
        "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf" | "properties" | "editorconfig"
        | ".gitignore" | ".gitattributes" => (Config, Text, Some(ext.trim_start_matches('.'))),
        ".env" | "pem" | "key" | "p12" | "pfx" | "keystore" | "jks" => (Secret, ReadOnlyText, None),
        "txt" | "text" | "log" | "rst" | "adoc" | "tex" | "org" => (Prose, Text, Some(ext)),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => (Image, GpuiImage, None),
        "heic" | "heif" | "tif" | "tiff" => (Image, NativeImage, None),
        // Raw SVG is active XML and may contain script, navigation, and remote resources.
        // It remains unsupported unless a dedicated audited SVG sanitizer is added.
        "svg" | "svgz" => (Image, Unsupported, None),
        "mp3" | "m4a" | "aac" | "wav" | "aiff" | "flac" | "ogg" | "oga" => {
            (FileFamily::Audio, PreferredKind::Audio, None)
        }
        "mp4" | "m4v" | "mov" | "webm" | "avi" | "mkv" | "ogv" | "mpg" | "mpeg" => {
            (FileFamily::Video, PreferredKind::Video, None)
        }
        "pdf" => (Prose, Pdf, None),
        "zip" | "gz" | "tgz" | "bz2" | "xz" | "7z" | "rar" | "tar" | "zst" | "jar" | "war"
        | "dmg" | "iso" | "cab" | "deb" | "rpm" | "apk" | "docx" | "xlsx" | "pptx" | "odt"
        | "ods" | "odp" => (Archive, Binary, None),
        "wasm" | "o" | "obj" | "a" | "lib" | "so" | "dylib" | "dll" | "exe" | "class" | "pyc"
        | "pyo" | "bin" | "app" => (Other, Unsupported, None),
        "sqlite" | "sqlite3" | "db" | "parquet" | "avro" | "arrow" | "woff" | "woff2" | "ttf"
        | "otf" | "ico" | "psd" => (Data, Binary, None),
        _ => (Other, Unknown, Some(ext)),
    };
    ExtensionFacts {
        family,
        preferred,
        syntax,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PresentationCacheKey {
    pub path: RelativeFilePath,
    pub revision: Arc<str>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedEditorEntry {
    pub text: Arc<str>,
    pub highlights: Arc<Vec<TextHighlightSpan>>,
    pub limit: ProjectionLimit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectionLimit {
    Complete,
    TruncatedAtCharacterLimit,
    TruncatedAtSpanLimit,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyntaxProjection {
    pub spans: Arc<Vec<TextHighlightSpan>>,
    pub limit: ProjectionLimit,
}

/// Framework-free LRU. Equal keys and values return the same retained Arc.
pub struct PresentationCache {
    entries: HashMap<PresentationCacheKey, Arc<ParsedEditorEntry>>,
    lru: VecDeque<PresentationCacheKey>,
    total_chars: usize,
}

impl Default for PresentationCache {
    fn default() -> Self {
        Self::new()
    }
}

impl PresentationCache {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            lru: VecDeque::new(),
            total_chars: 0,
        }
    }

    pub fn get(&mut self, key: &PresentationCacheKey) -> Option<Arc<ParsedEditorEntry>> {
        let value = self.entries.get(key)?.clone();
        self.touch(key);
        Some(value)
    }

    pub fn project(
        &mut self,
        key: PresentationCacheKey,
        presentation: &FilePresentation,
        text: Arc<str>,
    ) -> Result<Arc<ParsedEditorEntry>, ProjectionLimit> {
        let chars = text.chars().count();
        if chars > MAX_PRESENTATION_CHARS {
            return Err(ProjectionLimit::TruncatedAtCharacterLimit);
        }
        if let Some(existing) = self.entries.get(&key).cloned() {
            if existing.text == text {
                self.touch(&key);
                return Ok(existing);
            }
            self.remove(&key);
        }
        let projection = semantic_highlights_with_set(syntax_set(), presentation, &text);
        let entry = Arc::new(ParsedEditorEntry {
            text,
            highlights: projection.spans,
            limit: projection.limit,
        });
        self.total_chars += chars;
        self.entries.insert(key.clone(), entry.clone());
        self.lru.push_back(key);
        self.enforce_limits();
        Ok(entry)
    }

    fn touch(&mut self, key: &PresentationCacheKey) {
        if let Some(index) = self.lru.iter().position(|item| item == key) {
            self.lru.remove(index);
        }
        self.lru.push_back(key.clone());
    }
    fn remove(&mut self, key: &PresentationCacheKey) {
        if let Some(value) = self.entries.remove(key) {
            self.total_chars = self.total_chars.saturating_sub(value.text.chars().count());
        }
        if let Some(index) = self.lru.iter().position(|item| item == key) {
            self.lru.remove(index);
        }
    }
    fn enforce_limits(&mut self) {
        while self.entries.len() > MAX_CACHE_ENTRIES || self.total_chars > MAX_CACHE_CHARS {
            let Some(oldest) = self.lru.front().cloned() else {
                break;
            };
            self.remove(&oldest);
        }
    }
}

/// Convenience projection using the same immutable syntax set as `PresentationCache`.
/// Production document surfaces should prefer `PresentationCache::project` for stable reuse.
pub fn semantic_highlights(presentation: &FilePresentation, text: &str) -> SyntaxProjection {
    semantic_highlights_with_set(syntax_set(), presentation, text)
}

fn syntax_set() -> &'static SyntaxSet {
    static SYNTAXES: OnceLock<SyntaxSet> = OnceLock::new();
    SYNTAXES.get_or_init(SyntaxSet::load_defaults_newlines)
}

fn semantic_highlights_with_set(
    syntaxes: &SyntaxSet,
    presentation: &FilePresentation,
    text: &str,
) -> SyntaxProjection {
    let end = byte_index_at_char_limit(text, MAX_PRESENTATION_CHARS);
    let limit = if end < text.len() {
        ProjectionLimit::TruncatedAtCharacterLimit
    } else {
        ProjectionLimit::Complete
    };
    let bounded = &text[..end];
    let Some(syntax) = syntax_for(syntaxes, presentation) else {
        return SyntaxProjection {
            spans: Arc::new(Vec::new()),
            limit,
        };
    };
    let mut parser = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut spans = Vec::new();
    let mut offset = 0;
    let mut span_limit_reached = false;
    'lines: for line in syntect::util::LinesWithEndings::from(bounded) {
        let Ok(operations) = parser.parse_line(line, syntaxes) else {
            break;
        };
        for (range, op) in ScopeRangeIterator::new(&operations, line) {
            if spans.len() >= MAX_HIGHLIGHT_SPANS {
                span_limit_reached = true;
                break 'lines;
            }
            if stack.apply(op).is_err() {
                continue;
            }
            if range.start == range.end {
                continue;
            }
            if let Some(kind) = scope_kind(stack.as_slice()) {
                spans.push(TextHighlightSpan {
                    range: offset + range.start..offset + range.end,
                    kind,
                });
            }
        }
        offset += line.len();
        if spans.len() >= MAX_HIGHLIGHT_SPANS {
            span_limit_reached = true;
            break;
        }
    }
    SyntaxProjection {
        spans: Arc::new(spans),
        limit: if span_limit_reached {
            ProjectionLimit::TruncatedAtSpanLimit
        } else {
            limit
        },
    }
}

fn syntax_for<'a>(
    syntaxes: &'a SyntaxSet,
    presentation: &FilePresentation,
) -> Option<&'a SyntaxReference> {
    let hint = presentation.syntax_hint.as_deref()?;
    syntaxes
        .find_syntax_by_extension(hint)
        .or_else(|| syntaxes.find_syntax_by_token(hint))
}

fn scope_kind(scopes: &[Scope]) -> Option<TextHighlightKind> {
    let scope = scopes.last()?.to_string();
    if scope.contains("comment") {
        Some(TextHighlightKind::Comment)
    } else if scope.contains("string") {
        Some(TextHighlightKind::String)
    } else if scope.contains("constant.numeric") {
        Some(TextHighlightKind::Number)
    } else if scope.contains("keyword") || scope.contains("storage") {
        Some(TextHighlightKind::Keyword)
    } else if scope.contains("entity.name.function") || scope.contains("support.function") {
        Some(TextHighlightKind::Function)
    } else if scope.contains("entity.name.type")
        || scope.contains("support.type")
        || scope.contains("support.class")
    {
        Some(TextHighlightKind::Type)
    } else if scope.contains("constant") {
        Some(TextHighlightKind::Constant)
    } else if scope.contains("variable") {
        Some(TextHighlightKind::Variable)
    } else if scope.contains("operator") {
        Some(TextHighlightKind::Operator)
    } else if scope.contains("punctuation") {
        Some(TextHighlightKind::Punctuation)
    } else {
        None
    }
}

fn byte_index_at_char_limit(value: &str, max: usize) -> usize {
    value
        .char_indices()
        .nth(max)
        .map_or(value.len(), |(index, _)| index)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffLimit {
    Complete,
    TimedCoarse,
    TruncatedOutput,
    InputTooLarge,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffProjection {
    pub lines: Arc<Vec<FileDiffLine>>,
    pub limit: DiffLimit,
}

/// Composes a bounded line diff from two authoritative UTF-8 documents.
///
/// This is CPU projection work. Product integration must schedule it away from GPUI's UI
/// thread. The internal deadline is a second guardrail, not permission to block rendering.
pub fn project_line_diff(old: &str, new: &str) -> DiffProjection {
    let old_chars = old.chars().count();
    let new_chars = new.chars().count();
    let old_lines = old.lines().count();
    let new_lines = new.lines().count();
    if old_chars > MAX_PRESENTATION_CHARS
        || new_chars > MAX_PRESENTATION_CHARS
        || old_lines > MAX_DIFF_LINES_PER_SIDE
        || new_lines > MAX_DIFF_LINES_PER_SIDE
    {
        return DiffProjection {
            lines: Arc::new(Vec::new()),
            limit: DiffLimit::InputTooLarge,
        };
    }
    let started = Instant::now();
    let mut configuration = TextDiff::configure();
    configuration
        .algorithm(Algorithm::Myers)
        .timeout(MAX_DIFF_COMPUTE_TIME);
    // `similar` returns a valid coarser replacement when its deadline is reached.
    let diff = configuration.diff_lines(old, new);
    let timed_coarse = started.elapsed() >= MAX_DIFF_COMPUTE_TIME;
    let groups = diff.grouped_ops(DIFF_CONTEXT_LINES);
    let mut lines = Vec::new();
    let mut truncated = false;
    'groups: for (group_index, group) in groups.iter().enumerate() {
        let old_range = combined_range(group.iter().map(|op| op.old_range()));
        let new_range = combined_range(group.iter().map(|op| op.new_range()));
        let header = SharedString::from(format!(
            "@@ -{},{} +{},{} @@",
            display_start(&old_range),
            old_range.len(),
            display_start(&new_range),
            new_range.len()
        ));
        // The explicit Hunk kind plus the same text on both sides lets split UI render one
        // full-width header rather than treating it as an ordinary paired source row.
        if !push_diff_line(
            &mut lines,
            FileDiffLine {
                id: SharedString::from(format!("hunk-{group_index}")),
                kind: FileDiffLineKind::Hunk,
                old_line: None,
                new_line: None,
                old_text: Some(header.clone()),
                new_text: Some(header),
            },
        ) {
            truncated = true;
            break;
        }
        for op in group {
            match op.tag() {
                DiffTag::Replace => {
                    let mut removed = Vec::new();
                    let mut added = Vec::new();
                    for change in diff.iter_changes(op) {
                        match change.tag() {
                            ChangeTag::Delete => removed.push(change_side(&change)),
                            ChangeTag::Insert => added.push(change_side(&change)),
                            ChangeTag::Equal => {}
                        }
                    }
                    let count = removed.len().max(added.len());
                    for index in 0..count {
                        let old_side = removed.get(index).cloned();
                        let new_side = added.get(index).cloned();
                        let kind = match (&old_side, &new_side) {
                            (Some(_), Some(_)) => FileDiffLineKind::Changed,
                            (Some(_), None) => FileDiffLineKind::Removed,
                            (None, Some(_)) => FileDiffLineKind::Added,
                            (None, None) => continue,
                        };
                        if !push_sides(&mut lines, kind, old_side, new_side) {
                            truncated = true;
                            break 'groups;
                        }
                    }
                }
                DiffTag::Equal | DiffTag::Delete | DiffTag::Insert => {
                    for change in diff.iter_changes(op) {
                        let kind = match change.tag() {
                            ChangeTag::Equal => FileDiffLineKind::Context,
                            ChangeTag::Delete => FileDiffLineKind::Removed,
                            ChangeTag::Insert => FileDiffLineKind::Added,
                        };
                        let text = SharedString::from(
                            change.value().trim_end_matches(['\r', '\n']).to_owned(),
                        );
                        let (old_side, new_side) = match kind {
                            FileDiffLineKind::Removed => (
                                Some(DiffSide {
                                    line: change.old_index().map(line_number),
                                    text,
                                }),
                                None,
                            ),
                            FileDiffLineKind::Added => (
                                None,
                                Some(DiffSide {
                                    line: change.new_index().map(line_number),
                                    text,
                                }),
                            ),
                            FileDiffLineKind::Context => (
                                Some(DiffSide {
                                    line: change.old_index().map(line_number),
                                    text: text.clone(),
                                }),
                                Some(DiffSide {
                                    line: change.new_index().map(line_number),
                                    text,
                                }),
                            ),
                            _ => unreachable!(),
                        };
                        if !push_sides(&mut lines, kind, old_side, new_side) {
                            truncated = true;
                            break 'groups;
                        }
                    }
                }
            }
        }
    }
    DiffProjection {
        lines: Arc::new(lines),
        limit: if truncated {
            DiffLimit::TruncatedOutput
        } else if timed_coarse {
            DiffLimit::TimedCoarse
        } else {
            DiffLimit::Complete
        },
    }
}

#[derive(Clone)]
struct DiffSide {
    line: Option<u32>,
    text: SharedString,
}

fn change_side(change: &similar::Change<&str>) -> DiffSide {
    DiffSide {
        line: change
            .old_index()
            .or_else(|| change.new_index())
            .map(line_number),
        text: SharedString::from(change.value().trim_end_matches(['\r', '\n']).to_owned()),
    }
}

fn line_number(number: usize) -> u32 {
    number.saturating_add(1) as u32
}

fn push_sides(
    lines: &mut Vec<FileDiffLine>,
    kind: FileDiffLineKind,
    old_side: Option<DiffSide>,
    new_side: Option<DiffSide>,
) -> bool {
    let old_line = old_side.as_ref().and_then(|side| side.line);
    let new_line = new_side.as_ref().and_then(|side| side.line);
    let id = SharedString::from(format!(
        "diff-{}-{}-{}",
        old_line.unwrap_or(0),
        new_line.unwrap_or(0),
        lines.len()
    ));
    push_diff_line(
        lines,
        FileDiffLine {
            id,
            kind,
            old_line,
            new_line,
            old_text: old_side.map(|side| side.text),
            new_text: new_side.map(|side| side.text),
        },
    )
}

fn push_diff_line(lines: &mut Vec<FileDiffLine>, line: FileDiffLine) -> bool {
    if lines.len() >= MAX_DIFF_OUTPUT_LINES {
        false
    } else {
        lines.push(line);
        true
    }
}
fn combined_range(mut ranges: impl Iterator<Item = Range<usize>>) -> Range<usize> {
    let Some(first) = ranges.next() else {
        return 0..0;
    };
    ranges.fold(first, |all, next| {
        all.start.min(next.start)..all.end.max(next.end)
    })
}
fn display_start(range: &Range<usize>) -> usize {
    if range.is_empty() {
        range.start
    } else {
        range.start + 1
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MarkdownLink {
    InternalFile {
        path: RelativeFilePath,
        anchor: Option<Arc<str>>,
    },
    SameDocumentAnchor(Arc<str>),
    AbsoluteHttp(Arc<str>),
    Rejected,
}

/// Resolves a Markdown target lexically. It performs no I/O and never opens a URL.
pub fn resolve_markdown_link(current: &RelativeFilePath, target: &str) -> MarkdownLink {
    if target.is_empty() || target.len() > 16_384 || target.contains(['\0', '\\']) {
        return MarkdownLink::Rejected;
    }
    if let Some(anchor) = target.strip_prefix('#') {
        return if valid_anchor(anchor) {
            MarkdownLink::SameDocumentAnchor(Arc::from(anchor))
        } else {
            MarkdownLink::Rejected
        };
    }
    if let Ok(url) = Url::parse(target) {
        if matches!(url.scheme(), "http" | "https")
            && url.has_host()
            && url.username().is_empty()
            && url.password().is_none()
        {
            return MarkdownLink::AbsoluteHttp(Arc::from(url.as_str()));
        }
        return MarkdownLink::Rejected;
    }
    let (raw_path, anchor) = target
        .split_once('#')
        .map_or((target, None), |(path, anchor)| (path, Some(anchor)));
    if raw_path.is_empty()
        || raw_path.starts_with('/')
        || raw_path.contains('?')
        || anchor.is_some_and(|value| !valid_anchor(value))
    {
        return MarkdownLink::Rejected;
    }
    // A colon before any slash is a scheme-like target. Reject all non-http schemes explicitly.
    if raw_path
        .split('/')
        .next()
        .is_some_and(|first| first.contains(':'))
    {
        return MarkdownLink::Rejected;
    }
    let mut parts: Vec<String> = current.as_str().split('/').map(str::to_owned).collect();
    parts.pop();
    for encoded_part in raw_path.split('/') {
        if encoded_part.is_empty() || !valid_percent_encoding(encoded_part) {
            return MarkdownLink::Rejected;
        }
        let Ok(decoded) = percent_decode_str(encoded_part).decode_utf8() else {
            return MarkdownLink::Rejected;
        };
        // Decode once per segment. Encoded separators cannot create a second path level,
        // and `%252f` remains the literal filename text `%2f`.
        if decoded.contains(['/', '\\', '\0']) || decoded.chars().any(char::is_control) {
            return MarkdownLink::Rejected;
        }
        match decoded.as_ref() {
            "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return MarkdownLink::Rejected;
                }
            }
            value => parts.push(value.to_owned()),
        }
    }
    let Ok(path) = RelativeFilePath::parse(parts.join("/")) else {
        return MarkdownLink::Rejected;
    };
    MarkdownLink::InternalFile {
        path,
        anchor: anchor.map(Arc::from),
    }
}
fn valid_percent_encoding(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return false;
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    true
}

fn valid_anchor(anchor: &str) -> bool {
    !anchor.is_empty() && anchor.len() <= 2_048 && !anchor.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    use super::*;

    const STILL_IMAGE_FIXTURES: [(&str, &str); 4] = [
        (
            "png",
            "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC",
        ),
        (
            "jpg",
            "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDovBn/ACJ+hf8AXhB/6LWiiiv4mr/xZ+r/ADP4J4p/5H+P/wCv1X/0uR//2Q==",
        ),
        (
            "webp",
            "UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoCAAEAAMASJaACdLoAA1+ODIAAzj/1jv/v+nkf/8c2/8Vv/8Vv/45t4uQ+oQAA",
        ),
        (
            "bmp",
            "Qk0+AAAAAAAAADYAAAAoAAAAAgAAAAEAAAABABgAAAAAAAgAAADEDgAAxA4AAAAAAAAAAAAAAAD/AP8AAAA=",
        ),
    ];

    fn fixture_presentation(extension: &str, bytes: &[u8]) -> FilePresentation {
        let path = RelativeFilePath::parse(format!("fixture.{extension}")).unwrap();
        FilePresentation::from_external_bytes(&path, bytes)
    }

    #[test]
    fn valid_gpui_still_image_fixtures_pass_full_decode() {
        for (extension, encoded) in STILL_IMAGE_FIXTURES {
            let bytes = STANDARD.decode(encoded).unwrap();
            let presentation = fixture_presentation(extension, &bytes);
            assert_eq!(
                presentation.image,
                ImageProbe::Safe(ImageDimensions {
                    width: 2,
                    height: 1,
                }),
                "valid {extension} fixture must decode"
            );
            assert_eq!(presentation.kind, FilePresentationKind::GpuiImage);
        }
    }

    #[test]
    fn truncated_gpui_still_image_bodies_fail_after_dimension_probe() {
        for (extension, encoded) in STILL_IMAGE_FIXTURES {
            let bytes = STANDARD.decode(encoded).unwrap();
            let truncated = &bytes[..bytes.len() / 2];
            assert!(
                imagesize::blob_size(truncated).is_ok(),
                "truncated {extension} fixture must retain its dimension header"
            );
            let presentation = fixture_presentation(extension, truncated);
            assert_eq!(
                presentation.image,
                ImageProbe::DecodeUnavailable(ImageDimensions {
                    width: 2,
                    height: 1,
                }),
                "truncated {extension} body must not promise a preview"
            );
            assert_eq!(presentation.kind, FilePresentationKind::Unsupported);
        }
    }
}
